import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Channel, ToolContext, YEvent } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import type { Principal } from "../control/method-types.js";
import type { Store } from "../store/index.js";
import { createSocial } from "./social.js";
import { createSocialSupport } from "./social-support.js";

test("social inspection separates stored route facts from configured match prediction", async () => {
	const raw = JSON.stringify({
		schema: 1,
		id: "main",
		name: "Main",
		owner: "person:owner",
		defaultProfile: "default",
		profiles: { default: {} },
		bindings: [
			{ id: "group", match: { channel: "test", kind: "group" }, session: { mode: "persistent", per: "conv" } },
		],
		social: { enabled: true, defaults: { group: { mode: "mention", signals: { botMention: "respond" } } } },
	});
	const agent = parseAgentConfig(raw);
	const input = {
		id: "event-1",
		ts: "2026-11-01T00:00:00.000Z",
		type: "message.in",
		conv: "conv:test:group",
		data: { kind: "group" },
		routes: [{ agent: "main", binding: "group", session: "session-1" }],
	} as const;
	let history: YEvent[] = [
		input as unknown as YEvent,
		{
			id: "event-2",
			ts: "2026-11-01T00:00:01.000Z",
			type: "routing.social-decision",
			parent: input.id,
			data: {
				agent: "main",
				reason: "batch",
				revision: "r1",
				policy: { mode: "batch", batch: { run: true } },
				plugin: "social",
				batchBinding: "missing",
				consumerIssue: "source-profile-missing-plugin",
				profile: "feishu-p1",
				repair: "select social in profile feishu-p1",
			},
		},
	];
	const store = {
		events: {
			query: async (query: { type?: string }) => ({
				events: history.filter((event) => !query.type || event.type === query.type),
			}),
		},
		sessions: { get: async () => ({ profile: "default" }) },
		identity: () => ({ account: async () => undefined }),
	} as unknown as Store;
	const inspect = createSocialSupport(
		store,
		new Map([["main", agent]]),
		new Map([
			[
				"test",
				{ id: "test", kinds: ["dm", "group"], output: { stream: false, attachments: false } } as unknown as Channel,
			],
		]),
		new Map(),
		async () => ({ agent: { state: "effective", revision: "accepted-1", acceptedRevision: "accepted-1" } }),
	);
	const policy = agent.social?.defaults?.group;
	if (!policy) throw new Error("Expected group policy");
	const result = await inspect.inspectRoute("main", "conv:test:group", undefined, policy);
	const detail = JSON.parse(result.detail) as { history: { route: object }; prediction: object };
	expect(detail.history.route).toMatchObject({ binding: "group", session: "session-1", profile: "default" });
	expect(detail.prediction).toMatchObject({ state: "matched", binding: "group", profile: "default" });
	expect(result.capabilityGaps).toEqual([
		"unknown: channel capabilities for test are not declared",
		"unknown: inbound bot mention capability for test is not declared",
	]);
	expect(result.acceptedConfiguration).toEqual({
		state: "effective",
		revision: "accepted-1",
		acceptedRevision: "accepted-1",
	});
	expect(result.operability).toMatchObject({
		status: "observed",
		sample: { eventId: "event-1" },
		history: { route: { binding: "group", session: "session-1" } },
		prediction: { binding: "group" },
	});
	expect(result.policySource).toContain("reason=batch; plugin=social");
	const diagnosed = await inspect.inspectRoute("main", "conv:test:group", input.id, policy);
	expect(diagnosed.policySource).toContain("reason=batch; plugin=social");
	expect(diagnosed.policySource).toContain("consumer missing (source-profile-missing-plugin, profile=feishu-p1)");
	expect(diagnosed.policySource).toContain("select social in profile feishu-p1");
	history = [];
	const empty = await inspect.inspectRoute("main", "conv:test:group", undefined, policy);
	expect(JSON.parse(empty.detail)).toMatchObject({
		status: "unknown",
		reason: "no stored message.in for the selected conversation",
	});
});

test("social support verifies direct owner and continuation sources and rejects visitors or mixed inputs", async () => {
	const conv = "conv:test:owner";
	const route = { agent: "main", binding: "owner", session: "session-1" };
	const message = (id: string, from: string): YEvent => ({
		id,
		ts: "2026-11-01T00:00:00.000Z",
		type: "message.in",
		from,
		conv,
		data: { kind: "dm" },
		routes: [route],
	});
	const owner = message("owner", "acct:test:owner");
	const visitor = message("visitor", "acct:test:visitor");
	const continuation: YEvent = {
		id: "continuation",
		ts: "2026-11-01T00:01:00.000Z",
		type: "runtime.continuation",
		parent: owner.id,
		conv,
		data: { session: "session-1" },
		routes: [route],
	};
	const events = new Map([owner, visitor, continuation].map((event) => [event.id, event]));
	const store = {
		events: { get: async (id: string) => events.get(id) },
		sessions: { get: async () => ({ id: "session-1", agent: "main" }) },
		identity: () => ({
			relation: async (_agent: string, account: string) => (account === owner.from ? "owner" : "stranger"),
		}),
	} as unknown as Store;
	const support = createSocialSupport(store, new Map(), new Map());
	const ctx = (event: YEvent, inputs: YEvent[] = [event]) =>
		({ agent: "main", session: "session-1", event, events: inputs }) as ToolContext;
	expect(await support.ownerInput("main", ctx(owner))).toBe(true);
	expect(await support.ownerInput("main", ctx(visitor))).toBe(false);
	expect(await support.ownerInput("main", ctx(owner, [owner, visitor]))).toBe(false);
	expect(await support.ownerInput("main", ctx(continuation))).toBe(true);
});

test("verified owner requests preview or apply directly and preserve revision conflicts", async () => {
	const home = await tempHome("yonder-social-policy-");
	try {
		const file = join(home, "agent.yaml");
		const raw = JSON.stringify(
			{
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "default",
				profiles: { default: {} },
				bindings: [],
				social: {
					enabled: true,
					authorized: { conversations: ["conv:test:group"] },
					defaults: { group: { mode: "batch" } },
					conversations: {
						"conv:test:group": {
							batch: { count: 9, delaySeconds: 17, maxMessages: 23, maxBytes: 8192 },
							signals: { botMention: "record", ownerMention: "consider" },
						},
					},
				},
			},
			null,
			2,
		).replace('    "conversations": {', '    # preserve conversation comment\n    "conversations": {');
		await writeFile(file, raw);
		await writeFile(join(home, "yonder.yaml"), "{}");
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		const events: Array<{ data: object }> = [];
		const ownerInputs = new Set(["one", "continued"]);
		let failReloadOnce = false;
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			ownerInput: async (_agent, caller) => {
				const inputs = [...(caller.events ?? []), ...(caller.event ? [caller.event] : [])];
				return inputs.length > 0 && inputs.every((event) => ownerInputs.has(event.id));
			},
			target: async () => ({ kind: "group" }),
			record: async (event) => {
				events.push(event);
			},
			validate: async () => {},
			reload: async () => {
				if (failReloadOnce) {
					failReloadOnce = false;
					throw new Error("reload receipt failed");
				}
				agents.set("main", parseAgentConfig(await readFile(file, "utf8")));
			},
		});
		const ownerEvent = {
			id: "one",
			ts: "2026-11-01T00:00:00.000Z",
			type: "message.in",
			from: "acct:console:owner",
			conv: "conv:console:main",
			data: { kind: "dm", text: "change group" },
		} as YEvent;
		const ctx = {
			agent: "main",
			session: "s",
			profile: "default",
			capabilities: ["read", "admin"],
			channelInstances: ["test"],
			event: ownerEvent,
		} as unknown as ToolContext;
		const initial = await service.inspect({ agent: "main", conv: "conv:test:group" }, ctx);
		const request = {
			agent: "main",
			conv: "conv:test:group",
			expectedRevision: initial.revision,
			patch: {
				mode: "mention" as const,
				signals: { botMention: "respond" as const },
				triggers: { regex: ["^设计|界面$"], exclude: ["广告"], minLength: 2, maxLength: 2048 },
			},
			reason: "owner request",
		};
		const preview = await service.update(request, ctx);
		expect(preview.before.mode).toBe("batch");
		expect(parseAgentConfig(await readFile(file, "utf8")).social?.conversations?.[request.conv]?.batch).toEqual({
			count: 9,
			delaySeconds: 17,
			maxMessages: 23,
			maxBytes: 8192,
		});
		const visitor = {
			...ctx,
			event: { ...ownerEvent, id: "visitor", from: "acct:test:visitor" },
		};
		await expect(service.update({ ...request, dryRun: false }, visitor)).rejects.toMatchObject({ code: "forbidden" });
		await expect(
			service.update({ ...request, dryRun: false }, { ...ctx, events: [ownerEvent, visitor.event] }),
		).rejects.toMatchObject({ code: "forbidden" });
		// Trusted continuation source resolution is injected from the kernel's durable event ledger.
		const continuation = { ...ctx, event: { ...ownerEvent, id: "continued", type: "runtime.continuation" } };
		await service.update({ ...request, dryRun: false }, continuation);
		const appliedConfig = await readFile(file, "utf8");
		const appliedPolicy = parseAgentConfig(appliedConfig).social?.conversations?.[request.conv];
		expect(appliedPolicy?.mode).toBe("mention");
		expect(appliedPolicy?.triggers).toEqual(request.patch.triggers);
		expect(appliedPolicy?.signals).toEqual({ botMention: "respond", ownerMention: "consider" });
		expect(appliedConfig).toContain("# preserve conversation comment");
		expect(events.map((e) => (e.data as { result: string }).result)).toEqual(["rejected", "rejected", "applied"]);
		await expect(service.update({ ...request, dryRun: false }, ctx)).rejects.toMatchObject({ code: "conflict" });
		await service.auditDenied(
			{ id: "gateway:remote", kind: "remote", transport: "gateway", scopes: ["read"] },
			{ conv: "conv:test:group", reason: "secret" },
			"forbidden",
		);
		expect(events.at(-1)?.data).toEqual({
			actor: "gateway:remote",
			before: {},
			after: {},
			reason: "forbidden",
			revision: "unknown",
			result: "rejected",
		});
		const current = await service.inspect({ agent: "main", conv: request.conv }, ctx);
		const beforeFailedReload = await readFile(file, "utf8");
		failReloadOnce = true;
		await expect(
			service.update(
				{
					...request,
					expectedRevision: current.revision,
					patch: { mode: "batch", batch: { run: true } },
					reason: "enable bounded ordinary batches",
					dryRun: false,
				},
				ctx,
			),
		).rejects.toThrow("reload receipt failed");
		expect(await readFile(file, "utf8")).toBe(beforeFailedReload);
		expect((await service.inspect({ agent: "main", conv: request.conv }, ctx)).revision).toBe(current.revision);
		await service.update(
			{
				...request,
				expectedRevision: current.revision,
				patch: { mode: "batch", batch: { run: true } },
				reason: "enable bounded ordinary batches",
				dryRun: false,
			},
			ctx,
		);
		expect(parseAgentConfig(await readFile(file, "utf8")).social?.conversations?.[request.conv]?.batch).toEqual({
			count: 9,
			delaySeconds: 17,
			maxMessages: 23,
			maxBytes: 8192,
			run: true,
		});
		const currentAfterBatch = await service.inspect({ agent: "main", conv: request.conv }, ctx);
		const saved = await readFile(file, "utf8");
		for (const triggers of [{ regex: ["["] }, { regex: ["(a+"] }, { minLength: 20, maxLength: 10 }]) {
			for (const dryRun of [true, false]) {
				await expect(
					service.update(
						{ ...request, expectedRevision: currentAfterBatch.revision, patch: { triggers }, dryRun },
						ctx,
					),
				).rejects.toMatchObject({ code: "invalid_params" });
				expect(await readFile(file, "utf8")).toBe(saved);
				expect((await service.inspect({ agent: "main", conv: request.conv }, ctx)).revision).toBe(
					currentAfterBatch.revision,
				);
			}
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("explicit ordinary batches preflight the candidate before preview or write", async () => {
	const home = await tempHome("yonder-social-batch-preflight-");
	try {
		const conv = "conv:test:group";
		const file = join(home, "agent.yaml");
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "feishu-p1",
			profiles: { "feishu-p1": { plugins: [] } },
			bindings: [],
			social: {
				enabled: true,
				authorized: { conversations: [conv] },
				scope: ["conv:test:other"],
				defaults: { group: { mode: "batch" } },
				conversations: {},
			},
		});
		await writeFile(file, raw);
		await writeFile(join(home, "yonder.yaml"), "{}");
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		let routeState: "missing" | "ready" | "unknown" = "missing";
		let candidateChecks = 0;
		let validations = 0;
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			ownerInput: async (_agent, caller) => caller.event?.from === "acct:test:owner",
			target: async () => ({ kind: "group" }),
			record: async () => {},
			validate: async () => {
				validations++;
			},
			reload: async () => {
				agents.set("main", parseAgentConfig(await readFile(file, "utf8")));
			},
			inspectRoute: async (_agent, _conv, _event, _policy, candidate) => {
				if (candidate) candidateChecks++;
				const operability =
					routeState === "unknown"
						? { status: "unknown" as const, reason: "no trusted sample" }
						: {
								status: "observed" as const,
								prediction: {
									state: "matched" as const,
									profile: "feishu-p1",
									participation: { plugin: "social" },
									participationScope: { includesConversation: routeState === "ready" },
									consumer:
										routeState === "missing"
											? {
													state: "unavailable" as const,
													profile: "feishu-p1",
													plugin: "social",
													pluginSelected: false,
													matchingConsumer: false,
												}
											: { state: "available" as const, profile: "feishu-p1", plugin: "social", derived: false },
									capabilities: {
										values: [],
										plugins: candidate?.profiles["feishu-p1"]?.plugins ?? [],
										tools: { offer: [], search: [] },
										messageSend: false,
									},
								},
							};
				return { detail: "candidate route", capabilityGaps: [], operability };
			},
		});
		const owner: Principal = { transport: "socket", kind: "local", id: "local-owner", scopes: ["admin", "owner"] };
		const request = async (patch: Record<string, unknown>, expectedRevision: string, dryRun = true) =>
			service.update(
				{ agent: "main", conv, expectedRevision, patch: patch as never, reason: "owner request", dryRun },
				owner,
			);
		const firstRevision = (await service.inspect({ agent: "main", conv }, owner)).revision;
		const original = await readFile(file, "utf8");
		for (const dryRun of [true, false]) {
			let failure: unknown;
			try {
				await request({ batch: { run: true } }, firstRevision, dryRun);
			} catch (error) {
				failure = error;
			}
			expect(failure).toMatchObject({ code: "invalid_params" });
			const preflight = (failure as { data?: { preflight?: string } })?.data?.preflight;
			expect(preflight).toContain('"dependency":"social.scope"');
			expect(JSON.parse(preflight ?? "{}")).toMatchObject({
				state: "blocked",
				gaps: [
					{ dependency: "social.scope", field: "social.scope" },
					{ dependency: "participation-plugin", object: "agent:main.profiles.feishu-p1", field: "plugins" },
					{ dependency: "batch-consumer", fields: ["match", "profile", "session", "wake", "reply"] },
				],
			});
			expect(await readFile(file, "utf8")).toBe(original);
		}
		expect(candidateChecks).toBe(2);
		expect(validations).toBe(0);
		await expect(request({ batch: { run: true } }, "stale")).rejects.toMatchObject({ code: "conflict" });
		expect(candidateChecks).toBe(2);

		const scopedRaw = (await readFile(file, "utf8"))
			.replace('"conv:test:other"', `"${conv}"`)
			.replace('"plugins":[]', '"plugins":["social"]');
		const scoped = parseAgentConfig(scopedRaw);
		await writeFile(file, JSON.stringify(scoped));
		agents.set("main", scoped);
		routeState = "unknown";
		const scopedRevision = (await service.inspect({ agent: "main", conv }, owner)).revision;
		await expect(request({ mode: "batch", batch: { run: true } }, scopedRevision)).resolves.toMatchObject({
			after: { mode: "batch" },
			preflight: { state: "unknown", reason: "no trusted sample" },
		});
		routeState = "ready";
		const readyRevision = (await service.inspect({ agent: "main", conv }, owner)).revision;
		await expect(request({ batch: { run: true } }, readyRevision, false)).resolves.toMatchObject({
			after: { mode: "batch" },
			preflight: { state: "ready" },
		});

		const afterReady = (await service.inspect({ agent: "main", conv }, owner)).revision;
		await expect(request({ mode: "batch" }, afterReady)).resolves.toMatchObject({
			after: { mode: "batch" },
			preflight: { state: "ready" },
		});
		await request({ mode: "record" }, afterReady);
		await request({ mode: "mute" }, afterReady);
		expect(candidateChecks).toBe(5);
		const visitor = {
			agent: "main",
			session: "s",
			profile: "feishu-p1",
			capabilities: ["admin"],
			event: { id: "visitor", type: "message.in", from: "acct:test:visitor", conv, data: { kind: "group" } },
		} as unknown as ToolContext;
		await expect(
			service.update(
				{
					agent: "main",
					conv,
					expectedRevision: afterReady,
					patch: { batch: { run: true } },
					reason: "visitor request",
				},
				visitor,
			),
		).rejects.toMatchObject({ code: "forbidden" });
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("social policy can initialize from an absent optional block and reports accepted versus historical facts", async () => {
	const home = await tempHome("yonder-social-initialize-");
	try {
		const file = join(home, "agent.yaml");
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
		});
		await writeFile(file, raw);
		await writeFile(join(home, "yonder.yaml"), "{}");
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		let configuration = { state: "effective", revision: "accepted-r1", acceptedRevision: "accepted-r1" };
		const validatedRuns: boolean[] = [];
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			ownerInput: async () => true,
			target: async () => ({ kind: "group", membership: "main" }),
			record: async () => {},
			validate: async (next) => {
				const policy = next.get("main")?.social?.conversations?.["conv:test:group"];
				if (typeof policy?.batch?.run === "boolean") validatedRuns.push(policy.batch.run);
			},
			reload: async () => {
				agents.set("main", parseAgentConfig(await readFile(file, "utf8")));
			},
			inspectRoute: async () => ({
				detail: "historical sample only",
				capabilityGaps: [],
				acceptedConfiguration: configuration,
				operability: {
					status: "observed",
					sample: { eventId: "old-input", conv: "conv:test:group" },
					history: {
						route: { binding: "source", session: "session-1", profile: "group", wake: "write" },
						execution: { state: "not-observed" },
						delivery: { state: "not-observed" },
					},
					prediction: {
						state: "matched",
						binding: "source",
						profile: "group",
						wake: "write",
						consumer: { state: "available", binding: "batch", profile: "group", plugin: "social" },
					},
				},
			}),
		});
		const ownerEvent = {
			id: "owner-request",
			ts: "2026-11-03T00:00:00.000Z",
			type: "message.in",
			from: "acct:test:owner",
			conv: "conv:test:owner",
			data: { kind: "dm", text: "enable ordinary group batches" },
		} as YEvent;
		const ctx = {
			agent: "main",
			session: "main-session",
			profile: "default",
			capabilities: ["read", "admin"],
			channelInstances: ["test"],
			event: ownerEvent,
		} as unknown as ToolContext;
		const initial = await service.inspect({ agent: "main", conv: "conv:test:group" }, ctx);
		const applied = await service.update(
			{
				agent: "main",
				conv: "conv:test:group",
				expectedRevision: initial.revision,
				patch: { batch: { run: true } },
				reason: "verified owner request",
				dryRun: false,
			},
			ctx,
		);
		expect(validatedRuns[0]).toBe(true);
		expect(applied.postcondition).toMatchObject({
			status: "observed",
			policyRevision: applied.revision,
			acceptedConfiguration: { state: "effective", revision: "accepted-r1", acceptedRevision: "accepted-r1" },
			sample: { eventId: "old-input", conv: "conv:test:group" },
			history: {
				route: { binding: "source", profile: "group", wake: "write" },
				execution: { state: "not-observed" },
				delivery: { state: "not-observed" },
			},
			prediction: { consumer: { state: "available", binding: "batch" } },
		});
		expect(applied.postcondition).not.toHaveProperty("newInputRun");
		configuration = { state: "pending", revision: "disk-r2", acceptedRevision: "accepted-r1" };
		const fresh = await service.inspect({ agent: "main", conv: "conv:test:group" }, ctx);
		const pending = await service.update(
			{
				agent: "main",
				conv: "conv:test:group",
				expectedRevision: fresh.revision,
				patch: { batch: { run: false } },
				reason: "pending acceptance fixture",
				dryRun: false,
			},
			ctx,
		);
		expect(validatedRuns[1]).toBe(false);
		expect(pending.postcondition).toMatchObject({
			status: "unknown",
			acceptedConfiguration: { state: "pending", revision: "disk-r2", acceptedRevision: "accepted-r1" },
			history: { execution: { state: "not-observed" }, delivery: { state: "not-observed" } },
		});
		expect(pending.postcondition?.reason).toContain("accepted Agent configuration revision");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("bot gate injects a low-weight hint only after bot chatter crosses the window threshold", async () => {
	const home = await tempHome("yonder-social-gate-");
	try {
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
			social: { enabled: true, authorized: { conversations: ["conv:test:group"] } },
		});
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		const recorded: Array<{ type: string; conv?: string; data: object }> = [];
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			target: async () => ({ kind: "group" }),
			record: async (event) => {
				recorded.push(event);
			},
			validate: async () => {},
			reload: async () => {},
		});
		const now = Date.parse("2026-10-29T12:00:00.000Z");
		const minutesAgo = (minutes: number) => now - minutes * 60_000;
		const bots = (minutes: number[]) => minutes.map((minute) => ({ at: minutesAgo(minute), bot: true }));
		// 一个 15 分钟窗口里 3 条机器人消息正好等于阈值，不触发也不记账。
		const quiet = await service.botGate({ agent: "main", conv: "conv:test:group", events: bots([13, 7, 1]), now });
		expect(quiet).toEqual({ inject: false, frequencies: [0, 0, 0] });
		expect(recorded).toHaveLength(0);
		// 第 4 条触发：附前 3 个窗口的频率，记一条低权重的结构化事件供下一回合使用。
		const gated = await service.botGate({
			agent: "main",
			conv: "conv:test:group",
			events: bots([44, 31, 13, 12, 7, 1]),
			now,
		});
		expect(gated).toEqual({
			inject: true,
			frequencies: [0, 2, 0],
			hint: { windowMin: 15, threshold: 3, count: 4, frequencies: [0, 2, 0] },
		});
		expect(recorded.at(-1)).toMatchObject({
			type: "social.bot-gate",
			conv: "conv:test:group",
			data: { agent: "main", source: "bot", weight: "low", count: 4 },
		});
		// 真人的消息不计入机器人频率。
		const humans = [13, 7, 1].map((minute) => ({ at: minutesAgo(minute), bot: false }));
		expect(
			await service.botGate({ agent: "main", conv: "conv:test:group", events: [...bots([13, 7]), ...humans], now }),
		).toMatchObject({ inject: false });
		await expect(service.botGate({ agent: "ghost", conv: "conv:test:group", events: [], now })).rejects.toThrow(
			"Unknown agent",
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
