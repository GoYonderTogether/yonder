import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";
import { groupFixture, mainConv } from "./group-fixture.js";

const authSource = process.env.YONDER_GROUP_AUTH_SOURCE ?? process.env.YONDER_TEST_AUTH;
const enabled = process.env.YONDER_TEST_REAL === "1" && !!authSource && existsSync(authSource);

function sanitizeEvidence(value: unknown, paths: string[]) {
	const json = JSON.stringify(value, (key, item) => {
		if (/(?:api.?key|token|secret|password|credential|authorization|access|refresh)/iu.test(key)) return "[REDACTED]";
		if (typeof item !== "string") return item;
		return paths
			.filter(Boolean)
			.reduce((text, path) => text.replaceAll(path, "[PATH]"), item)
			.replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
			.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED_KEY]")
			.replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?)[^\s"']+/giu, "$1[REDACTED]");
	});
	return JSON.parse(json);
}

function safeSocialUpdateArgs(value: unknown) {
	if (!value || typeof value !== "object") return undefined;
	const args = value as Record<string, unknown>;
	const patch = args.patch && typeof args.patch === "object" ? (args.patch as Record<string, unknown>) : {};
	const batch = patch.batch && typeof patch.batch === "object" ? (patch.batch as Record<string, unknown>) : {};
	return {
		...(typeof args.agent === "string" ? { agent: args.agent.slice(0, 100) } : {}),
		...(typeof args.conv === "string" ? { conv: args.conv.slice(0, 300) } : {}),
		...(typeof args.dryRun === "boolean" ? { dryRun: args.dryRun } : {}),
		patch: {
			...(typeof patch.mode === "string" ? { mode: patch.mode.slice(0, 40) } : {}),
			...(Object.keys(batch).length
				? {
						batch: {
							...(typeof batch.run === "boolean" ? { run: batch.run } : {}),
							...(typeof batch.delaySeconds === "number" ? { delaySeconds: batch.delaySeconds } : {}),
						},
					}
				: {}),
			...(typeof patch.minIntervalSeconds === "number" ? { minIntervalSeconds: patch.minIntervalSeconds } : {}),
		},
	};
}

function safeSocialUpdateFailure(text: string) {
	let result: unknown;
	try {
		result = JSON.parse(text);
	} catch {
		return { message: text.slice(0, 400), unparsed: true, textLength: text.length };
	}
	if (!result || typeof result !== "object") return { unparsed: true, textLength: text.length };
	const data = result as Record<string, unknown>;
	const details = data.details && typeof data.details === "object" ? (data.details as Record<string, unknown>) : {};
	let preflight: Record<string, unknown> = {};
	if (typeof details.preflight === "string") {
		try {
			const parsed = JSON.parse(details.preflight);
			if (parsed && typeof parsed === "object") preflight = parsed as Record<string, unknown>;
		} catch {
			preflight = { unparsed: true };
		}
	} else if (details.preflight && typeof details.preflight === "object") {
		preflight = details.preflight as Record<string, unknown>;
	}
	const gaps = Array.isArray(preflight.gaps)
		? preflight.gaps.slice(0, 6).map((gap) => {
				if (!gap || typeof gap !== "object") return { value: String(gap).slice(0, 240) };
				const item = gap as Record<string, unknown>;
				return Object.fromEntries(
					[
						"dependency",
						"object",
						"field",
						"fields",
						"conv",
						"repair",
						"profile",
						"plugin",
						"pluginSelected",
						"matchingConsumer",
					].flatMap((key) => {
						const value = item[key];
						if (typeof value === "string") return [[key, value.slice(0, 240)]];
						if (
							typeof value === "boolean" ||
							(Array.isArray(value) && value.every((entry) => typeof entry === "string"))
						)
							return [[key, value]];
						return [];
					}),
				);
			})
		: undefined;
	return {
		...(typeof data.code === "string" ? { code: data.code.slice(0, 80) } : {}),
		...(typeof data.error === "string" ? { message: data.error.slice(0, 400) } : {}),
		...(typeof data.message === "string" ? { message: data.message.slice(0, 400) } : {}),
		...(typeof preflight.state === "string" ? { preflightState: preflight.state.slice(0, 40) } : {}),
		...(typeof preflight.agent === "string" ? { preflightAgent: preflight.agent.slice(0, 100) } : {}),
		...(typeof preflight.conv === "string" ? { preflightConv: preflight.conv.slice(0, 300) } : {}),
		...(gaps?.length ? { preflightGaps: gaps } : {}),
	};
}

function socialUpdateTranscriptEvidence(
	items: readonly { kind: string; text: string; tools?: readonly { name: string; args: object }[] }[],
) {
	const calls: Array<{ name: string; args: ReturnType<typeof safeSocialUpdateArgs> }> = [];
	const failures: Array<ReturnType<typeof safeSocialUpdateFailure>> = [];
	const pending: string[] = [];
	for (const item of items) {
		if (item.kind === "pi.assistant") {
			for (const tool of item.tools ?? []) {
				pending.push(tool.name);
				if (tool.name === "social_update" && calls.length < 8)
					calls.push({ name: tool.name, args: safeSocialUpdateArgs(tool.args) });
			}
			continue;
		}
		if (item.kind !== "pi.tool-result" || pending.length === 0) continue;
		const name = pending.shift();
		if (name !== "social_update" || failures.length >= 8) continue;
		const failure = safeSocialUpdateFailure(item.text);
		if ("message" in failure || "code" in failure || "preflightState" in failure || "unparsed" in failure)
			failures.push(failure);
	}
	return { calls, failures };
}

test.skipIf(!enabled)(
	"real Luna handles the owner's natural group request through parent and batch routes",
	async () => {
		const attempt = randomUUID();
		const evidencePath = resolve(`.cache/self-config-group-${attempt}.json`);
		let fixture: Awaited<ReturnType<typeof groupFixture>> | undefined;
		let release: NodeJS.Timeout | undefined;
		let firstId: string | undefined;
		let ordinaryId: string | undefined;
		let groupSessionId: string | undefined;
		let generatedParentBinding: unknown;
		let explicitBatchBindingIds: string[] = [];
		try {
			fixture = await groupFixture({
				social: true,
				officialGroup: true,
				ownerHandoff: true,
				initialBatchRun: false,
				authSource,
				model: "openai/gpt-6-luna",
				allowProvider: true,
			});
			const { home, kernel, probe } = fixture;
			const initialAgent = parse(await readFile(resolve(fixture.home, "agents/main/agent.yaml"), "utf8")) as {
				bindings: Array<{ id: string; match?: unknown; session?: unknown; profile?: unknown }>;
			};
			generatedParentBinding = initialAgent.bindings.find((binding) => binding.id === "parent-request");
			explicitBatchBindingIds = initialAgent.bindings
				.filter((binding) => binding.id.endsWith("batch"))
				.map((binding) => binding.id);
			expect(generatedParentBinding).toMatchObject({
				id: "parent-request",
				match: { channel: "agent", kind: "parent-request", from: "acct:agent:main" },
				session: "main",
				profile: "private",
			});
			expect(explicitBatchBindingIds).toEqual([]);
			release = setInterval(() => {
				for (const resume of probe.releases.values()) resume();
			}, 25);
			const first = await probe.ios["qq-main"].emit({
				type: "message.in",
				from: "acct:qq-main:owner",
				conv: mainConv,
				data: {
					kind: "group",
					text: "你去申请吧，我们这个群是工作群，你也可以直接让主会话接入进来，不用你做分身了。首先，第一个需求就是把这个群改成你是每条消息都能够接收，而不是用什么策略来管，然后但是接收了不一定要回复，这个要标注一下，你是有主动发言的权限的",
					mentioned: true,
					msgId: randomUUID(),
					social: { mentions: { bot: true } },
				},
			});
			firstId = first.id;
			groupSessionId = first.routes?.find((route) => route.agent === "main" && route.session)?.session;
			const parentWait = expect
				.poll(
					async () => {
						const request = (await kernel.events.query({ type: "message.in", after: first.id })).events.find(
							(event) => (event.data as { kind?: string }).kind === "parent-request",
						);
						return request;
					},
					{ timeout: 180_000, interval: 250 },
				)
				.toBeTruthy();
			const policyWait = expect
				.poll(
					async () => {
						const current = parse(await readFile(resolve(home, "agents/main/agent.yaml"), "utf8")) as {
							social?: { conversations?: Record<string, { mode?: string; batch?: { run?: boolean } }> };
						};
						return current.social?.conversations?.[mainConv];
					},
					{ timeout: 180_000, interval: 500 },
				)
				.toMatchObject({ mode: "batch", batch: { run: true } });
			const firstBatchWait = expect
				.poll(
					async () =>
						(await kernel.events.query({ type: "social.batch-ready", conv: mainConv, after: first.id })).events.find(
							(event) => (event.data as { sourceEvents?: string[] }).sourceEvents?.includes(first.id),
						),
					{ timeout: 180_000, interval: 250 },
				)
				.toBeTruthy();
			await Promise.all([parentWait, policyWait, firstBatchWait]);
			const firstBatch = (
				await kernel.events.query({ type: "social.batch-ready", conv: mainConv, after: first.id })
			).events.find((event) => (event.data as { sourceEvents?: string[] }).sourceEvents?.includes(first.id));
			const parentRequest = (await kernel.events.query({ type: "message.in", after: first.id })).events.find(
				(event) => (event.data as { kind?: string }).kind === "parent-request",
			);
			await expect
				.poll(
					async () =>
						(await kernel.events.query({ type: "run.end", after: first.id })).events.find((event) =>
							(event.data as { inputs?: string[] }).inputs?.includes(firstBatch?.id ?? ""),
						),
					{ timeout: 120_000, interval: 500 },
				)
				.toBeTruthy();
			const agentYaml = await readFile(resolve(home, "agents/main/agent.yaml"), "utf8");
			const configured = parse(agentYaml) as {
				social?: { conversations?: Record<string, { mode?: string; batch?: { run?: boolean } }> };
			};
			const profile = (await kernel.management({ action: "inspect", agent: "main", profile: "group" })) as {
				tools?: Array<{ name: string }>;
			};
			const effectiveAgent = (await kernel.management({ action: "agents.show", id: "main" })) as {
				social?: { conversations?: Record<string, { mode?: string; batch?: { run?: boolean } }> };
			};
			const groupSession = groupSessionId;
			const parentSession = parentRequest?.routes?.find((route) => route.session)?.session;
			const parentSessionInfo = parentSession ? await kernel.sessions.get(parentSession) : undefined;
			const firstRun = (await kernel.events.query({ type: "run.end", after: first.id })).events.find((event) =>
				(event.data as { inputs?: string[] }).inputs?.includes(firstBatch?.id ?? ""),
			);
			const second = await probe.ios["qq-main"].emit({
				type: "message.in",
				from: "acct:qq-main:owner",
				conv: mainConv,
				data: {
					kind: "group",
					text: "我把明天的会议改到下午三点，大家看一下。",
					mentioned: false,
					msgId: randomUUID(),
				},
			});
			ordinaryId = second.id;
			await expect
				.poll(
					async () =>
						(await kernel.events.query({ type: "social.batch-ready", conv: mainConv, after: second.id })).events.find(
							(event) => (event.data as { sourceEvents?: string[] }).sourceEvents?.includes(second.id),
						),
					{ timeout: 30_000, interval: 250 },
				)
				.toBeTruthy();
			const batch = (
				await kernel.events.query({ type: "social.batch-ready", conv: mainConv, after: second.id })
			).events.find((event) => (event.data as { sourceEvents?: string[] }).sourceEvents?.includes(second.id));
			await expect
				.poll(
					async () =>
						(await kernel.events.query({ type: "run.end", after: second.id })).events.find((event) =>
							(event.data as { inputs?: string[] }).inputs?.includes(batch?.id ?? ""),
						),
					{ timeout: 90_000, interval: 500 },
				)
				.toBeTruthy();
			const followupRun = (await kernel.events.query({ type: "run.end", after: second.id })).events.find((event) =>
				(event.data as { inputs?: string[] }).inputs?.includes(batch?.id ?? ""),
			);
			const evidence = {
				attempt,
				generatedParentBinding,
				explicitBatchBindingIds,
				first: {
					id: first.id,
					route: first.routes?.map((route) => ({ agent: route.agent, session: route.session, dropped: route.dropped })),
				},
				firstBatch: firstBatch && { id: firstBatch.id, data: firstBatch.data },
				parentRequest: parentRequest && { id: parentRequest.id, parent: parentRequest.parent, session: parentSession },
				parentSession: parentSessionInfo && {
					agent: parentSessionInfo.agent,
					profile: parentSessionInfo.profile,
					mode: parentSessionInfo.mode,
				},
				groupSession,
				firstRun: firstRun && {
					status: (firstRun.data as { status?: string }).status,
					model: (firstRun.data as { model?: string }).model,
					inputs: (firstRun.data as { inputs?: string[] }).inputs,
				},
				configuredPolicy: configured.social?.conversations?.[mainConv],
				effectivePolicy: effectiveAgent.social?.conversations?.[mainConv],
				canSpeak: profile.tools?.some((tool) => tool.name === "message_send"),
				ordinary: {
					id: second.id,
					route: second.routes?.map((route) => ({
						agent: route.agent,
						session: route.session,
						dropped: route.dropped,
					})),
				},
				batch: batch && { id: batch.id, parent: batch.parent, data: batch.data },
				followupRun: followupRun && {
					status: (followupRun.data as { status?: string }).status,
					model: (followupRun.data as { model?: string }).model,
					inputs: (followupRun.data as { inputs?: string[] }).inputs,
				},
				delivery: (await kernel.events.query({ type: "message.out", conv: mainConv, after: second.id })).events.map(
					(event) => (event.data as { delivery?: unknown }).delivery,
				),
			};
			await mkdir(dirname(evidencePath), { recursive: true });
			await writeFile(evidencePath, JSON.stringify(evidence, null, 2), { mode: 0o600, flag: "wx" });
			expect(parentRequest).toBeTruthy();
			expect(firstBatch?.data).toMatchObject({ sourceEvents: expect.arrayContaining([first.id]) });
			expect(parentRequest?.parent).toBe(firstBatch?.id);
			expect(parentSessionInfo).toMatchObject({ agent: "main", profile: "private", mode: "main" });
			expect(groupSession).toBeTruthy();
			expect(groupSession).not.toBe(parentSession);
			expect(firstRun?.data).toMatchObject({
				status: "done",
				model: "openai/gpt-6-luna",
				inputs: expect.arrayContaining([firstBatch?.id]),
			});
			expect(configured.social?.conversations?.[mainConv]).toMatchObject({ mode: "batch", batch: { run: true } });
			expect(effectiveAgent.social?.conversations?.[mainConv]).toMatchObject({ mode: "batch", batch: { run: true } });
			expect(profile.tools).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: "parent_ask" }),
					expect.objectContaining({ name: "message_send" }),
				]),
			);
			expect(batch?.data).toMatchObject({ sourceEvents: expect.arrayContaining([second.id]) });
			expect(followupRun?.data).toMatchObject({ status: "done", model: "openai/gpt-6-luna" });
		} catch (error) {
			await mkdir(dirname(evidencePath), { recursive: true });
			let diagnostic: Record<string, unknown> = {};
			if (fixture && firstId) {
				try {
					const { kernel } = fixture;
					const types = [
						"run.start",
						"run.end",
						"message.in",
						"message.out",
						"config.reload",
						"social.policy-change",
						"routing.social-decision",
						"social.batch-ready",
					];
					const pages = await Promise.all(
						types.map((type) => kernel.events.query({ type, after: firstId, limit: 500 })),
					);
					const events = pages.flatMap((page) => page.events).sort((a, b) => a.id.localeCompare(b.id));
					const accepted = (await kernel.events.query({ id: firstId })).events[0];
					const runs = await kernel.events.query({ type: "run.start", after: firstId, limit: 500 });
					const sessions = new Set([
						"main",
						...(groupSessionId ? [groupSessionId] : []),
						...(accepted?.routes?.map((route) => route.session).filter(Boolean) ?? []),
						...events.flatMap((event) => event.routes?.map((route) => route.session).filter(Boolean) ?? []),
						...(runs.events.map((event) => (event.data as { session?: string }).session).filter(Boolean) as string[]),
					]);
					const sessionToolEvidence = await Promise.all(
						[...sessions].map(async (session) => ({
							session,
							evidence: socialUpdateTranscriptEvidence(await kernel.sessions.transcript(session).catch(() => [])),
						})),
					);
					const currentAgent = parse(await readFile(resolve(fixture.home, "agents/main/agent.yaml"), "utf8")) as {
						social?: { conversations?: Record<string, unknown> };
						profiles?: Record<string, { level?: string; capabilities?: string[]; tools?: unknown }>;
					};
					const effectiveAgent = await kernel.management({ action: "agents.show", id: "main" }).catch(() => undefined);
					diagnostic = {
						generatedParentBinding,
						explicitBatchBindingIds,
						firstInput: accepted && {
							id: accepted.id,
							parent: accepted.parent,
							from: accepted.from,
							conv: accepted.conv,
							routes: accepted.routes?.map((route) => ({
								agent: route.agent,
								session: route.session,
								dropped: route.dropped,
							})),
						},
						events: events.slice(-200).map((event) => ({
							id: event.id,
							type: event.type,
							parent: event.parent,
							from: event.from,
							conv: event.conv,
							routes: event.routes?.map((route) => ({
								agent: route.agent,
								session: route.session,
								dropped: route.dropped,
							})),
							data: Object.fromEntries(
								[
									"agent",
									"session",
									"model",
									"status",
									"inputs",
									"action",
									"result",
									"scope",
									"reason",
									"policy",
									"before",
									"after",
									"sourceEvents",
									"policyRevision",
									"run",
									"matched",
									"focused",
									"kind",
									"text",
									"delivery",
								].flatMap((key) =>
									Object.hasOwn(event.data as object, key) ? [[key, (event.data as Record<string, unknown>)[key]]] : [],
								),
							),
						})),
						sessionToolEvidence,
						configuredPolicy: currentAgent.social?.conversations?.[mainConv],
						groupProfile: currentAgent.profiles?.group,
						effectiveSocial: (effectiveAgent as { social?: unknown } | undefined)?.social,
					};
				} catch (diagnosticError) {
					diagnostic = { captureError: String(diagnosticError).slice(-1000) };
				}
			}
			await writeFile(
				evidencePath.replace(/\.json$/u, ".failure.json"),
				JSON.stringify(
					sanitizeEvidence(
						{
							attempt,
							firstId,
							ordinaryId,
							generatedParentBinding,
							explicitBatchBindingIds,
							error: String(error).slice(-2000),
							diagnostic,
						},
						[authSource ?? "", fixture?.home ?? ""],
					),
					null,
					2,
				),
				{ mode: 0o600, flag: "wx" },
			);
			throw error;
		} finally {
			if (release) clearInterval(release);
			await fixture?.close();
		}
	},
	300_000,
);
