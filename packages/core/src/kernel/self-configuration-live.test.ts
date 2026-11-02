import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { controlHandler, initHome, openKernel, releaseInfo, serveControl } from "../index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const evidencePath = resolve(".cache/self-config-20261101/real-luna-evidence.json");

async function persistEvidence(value: unknown) {
	await mkdir(dirname(evidencePath), { recursive: true });
	await writeFile(evidencePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function safeEvidenceText(text: string): string {
	return text
		.replaceAll(auth, "[AUTH_PATH]")
		.replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED_KEY]")
		.replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?)[^\s"']+/giu, "$1[REDACTED]")
		.slice(-2_000);
}

function toolResultEvidence(result: object | undefined) {
	if (!result) return undefined;
	const value = result as {
		isError?: boolean;
		text?: string;
		content?: Array<{ type?: string; text?: string }>;
		output?: Array<{ type?: string; text?: string }>;
	};
	const text = [
		value.text,
		...(value.content ?? []).filter((item) => item.type === "text").map((item) => item.text ?? ""),
		...(value.output ?? []).filter((item) => item.type === "text").map((item) => item.text ?? ""),
	]
		.filter(Boolean)
		.join("\n");
	const summary: Record<string, unknown> = { isError: value.isError === true };
	if (value.isError) summary.errorSummary = safeEvidenceText(text);
	else {
		try {
			const json = parse(text) as Record<string, unknown>;
			for (const key of ["valid", "saved", "accepted", "restartRequired", "revision", "model", "profile"])
				if (key in json) summary[key] = json[key];
		} catch {
			summary.resultLength = text.length;
		}
	}
	return summary;
}

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"historical guided smoke: real Luna applies a separate group profile through the local CLI",
	async () => {
		const home = await tempHome("yonder-self-config-live-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let control: Awaited<ReturnType<typeof serveControl>> | undefined;
		let stopObserving: (() => Promise<void>) | undefined;
		let socket: Socket | undefined;
		const health: Array<{ key?: string; state?: string; at: number }> = [];
		const runtimeUpdates: Array<Record<string, unknown>> = [];
		const controlRequests: Array<{ method: string; action?: string; id?: string; agent?: string; profile?: string }> =
			[];
		try {
			await initHome(home, "owner", { model: testModel });
			const configPath = resolve(home, "yonder.yaml");
			const config = parse(await readFile(configPath, "utf8"));
			config.credentials = auth;
			config.channels["group-cli"] = { type: "cli" };
			config.identity.persons[0].accounts.push("acct:group-cli:local");
			await writeFile(configPath, stringify(config));

			const agentPath = resolve(home, "agents/main/agent.yaml");
			const agent = parse(await readFile(agentPath, "utf8"));
			agent.profiles.group = {
				model: "openai/gpt-6.1-sol",
				level: "readonly",
				tools: { offer: [], search: [] },
			};
			agent.profiles.owner.tools = { offer: ["bash"], search: [] };
			const privateProfile = structuredClone(agent.profiles.owner);
			agent.bindings.push({
				id: "group-cli",
				match: { channel: "group-cli", kind: "dm", from: "owner" },
				session: { mode: "persistent", per: "conv" },
				profile: "group",
				stream: false,
			});
			await writeFile(agentPath, stringify(agent));

			const before = structuredClone(agent.profiles);
			const candidatePath = resolve(home, "group-profile-candidate.json");
			const validateResultPath = resolve(home, "cli-validate-result.json");
			const updateResultPath = resolve(home, "cli-update-result.json");
			const cli = resolve("packages/cli/dist/index.js");
			kernel = await openKernel(home, {
				log: (level, message, data) => {
					if (message !== "Model health") return;
					const event = data as { key?: string; state?: string } | undefined;
					health.push({
						...(event?.key ? { key: event.key } : {}),
						...(event?.state ? { state: event.state } : {}),
						at: Date.now(),
					});
					if (level === "error") {
						const last = health.at(-1);
						if (last) last.state = "error";
					}
				},
			});
			const running = kernel;
			const realControl = controlHandler({
				kernel: running,
				home,
				releaseInfo: () => releaseInfo(home),
				awakeStatus: () => ({}),
				stop: () => {},
			});
			control = await serveControl(home, async (request, connection) => {
				if (request.method === "management") {
					const params = (request.params ?? {}) as {
						action?: string;
						id?: string;
						agent?: string;
						profile?: string;
					};
					controlRequests.push({
						method: request.method,
						...(params.action ? { action: params.action } : {}),
						...(params.id ? { id: params.id } : {}),
						...(params.agent ? { agent: params.agent } : {}),
						...(params.profile ? { profile: params.profile } : {}),
					});
				}
				return realControl(request, connection);
			});
			const offered = (await running.management({ action: "inspect", agent: "main", profile: "owner" })) as {
				profile?: string;
				tools?: Array<{ name: string; capabilities: string[]; exposure: string }>;
			};
			const receipt = await running.bots.send(
				"main",
				`Use the actual bash tool and local management CLI at ${cli} with this isolated home: ${home}. First inspect main's current private and group profiles using the CLI, then determine how to make a candidate file at ${candidatePath} that changes only the group profile model to ${testModel}; leave the private profile, defaults, bindings, and every other field unchanged. Use the CLI's own validation and update flow for that candidate, saving the unmodified validation response to ${validateResultPath} and update response to ${updateResultPath}. Finally read back the group profile and main agent through the CLI. You may write only those three temporary files inside this isolated home and use the CLI management flow to update main's target profile. Do not directly edit other configuration files, change the test setup, or touch a formal home. Report whether validation and update were accepted and the readback model.`,
			);
			stopObserving = await running.sessions.observe(receipt.session, async (update) => {
				const at = Date.now();
				if (update.type === "tool" && update.tool) {
					runtimeUpdates.push({
						type: update.type,
						phase: update.tool.phase,
						name: update.tool.name,
						at,
						...(update.tool.phase === "end" ? { result: toolResultEvidence(update.tool.result) } : {}),
					});
				} else if (update.type === "message" && update.message) {
					const message = update.message as { role?: string; content?: Array<{ type?: string; text?: string }> };
					if (message.role === "assistant" && !update.streaming) {
						const text = (message.content ?? [])
							.filter((part) => part.type === "text")
							.map((part) => part.text ?? "")
							.join("\n");
						runtimeUpdates.push({ type: "assistant-final", text: safeEvidenceText(text), at });
					}
				} else if (update.type === "state") {
					runtimeUpdates.push({ type: update.type, running: update.running, inputs: update.inputs, at });
				} else if (update.type === "error") {
					runtimeUpdates.push({ type: update.type, error: safeEvidenceText(update.error ?? ""), at });
				}
			});
			const inputEvent = async () => (await running.events.query({ type: "message.in", id: receipt.event })).events[0];
			const firstRun = async () =>
				(await running.events.query({ type: "run.end" })).events.find((event) => {
					const data = event.data as { inputs?: string[] };
					return event.parent === receipt.event || data.inputs?.includes(receipt.event);
				});
			const startedAt = Date.now();
			let completed = await firstRun();
			while (!completed && !health.some((event) => event.state === "held") && Date.now() - startedAt < 180_000) {
				await new Promise((done) => setTimeout(done, 500));
				completed = await firstRun();
			}
			if (!completed) {
				const [acceptedInput, starts, ends, transcript] = await Promise.all([
					inputEvent(),
					running.events.query({ type: "run.start" }),
					running.events.query({ type: "run.end" }),
					running.sessions.transcript(receipt.session),
				]);
				const summarize = (event: (typeof starts.events)[number]) => {
					const data = event.data as { inputs?: string[]; model?: string; status?: string };
					return {
						id: event.id,
						type: event.type,
						parent: event.parent,
						inputs: data.inputs,
						model: data.model,
						status: data.status,
						at: event.ts,
					};
				};
				const routeData = acceptedInput?.routes?.map((route) => ({
					agent: route.agent,
					session: route.session,
					dropped: route.dropped,
				}));
				const tools = transcript.flatMap((entry) => entry.tools ?? []).map((tool) => tool.name);
				throw new Error(
					`No run.end after ${Date.now() - startedAt}ms; runtime observation: ${JSON.stringify({
						receipt: { event: receipt.event, session: receipt.session },
						input: acceptedInput
							? { id: acceptedInput.id, type: acceptedInput.type, parent: acceptedInput.parent, routes: routeData }
							: null,
						starts: starts.events.map(summarize),
						ends: ends.events.map(summarize),
						tools,
						health,
					})}`,
				);
			}
			const completedData = completed?.data as { status?: string; model?: string; inputs?: string[] } | undefined;
			const calls = (await running.sessions.transcript(receipt.session)).flatMap((entry) => entry.tools ?? []);
			const toolNames = calls.map((call) => call.name);
			const candidateExists = existsSync(candidatePath);
			const validationText = candidateExists ? await readFile(validateResultPath, "utf8").catch(() => "") : "";
			const updateText = candidateExists ? await readFile(updateResultPath, "utf8").catch(() => "") : "";
			const readReceipt = (text: string) => {
				try {
					return parse(text) as Record<string, unknown>;
				} catch {
					return undefined;
				}
			};
			const validationReceipt = readReceipt(validationText);
			const updateReceipt = readReceipt(updateText);
			const saved = parse(await readFile(agentPath, "utf8"));
			const configurationChecks = {
				privateProfileUnchanged: JSON.stringify(saved.profiles.owner) === JSON.stringify(privateProfile),
				groupProfileUpdatedOnly:
					JSON.stringify(saved.profiles.group) ===
					JSON.stringify({
						...before.group,
						model: testModel,
					}),
				bindingsUnchanged: JSON.stringify(saved.bindings) === JSON.stringify(agent.bindings),
				defaultsUnchanged: JSON.stringify(saved.defaults) === JSON.stringify(agent.defaults),
			};
			const evidence = {
				receipt,
				offered: {
					profile: offered.profile,
					tools: offered.tools
						?.filter((tool) => tool.name === "bash" || tool.capabilities.includes("exec"))
						.map(({ name, capabilities, exposure }) => ({ name, capabilities, exposure })),
				},
				run: {
					status: completedData?.status,
					model: completedData?.model,
					inputs: completedData?.inputs,
					at: completed?.ts,
				},
				tools: runtimeUpdates.filter((update) => update.type === "tool"),
				assistantFinal: runtimeUpdates.filter((update) => update.type === "assistant-final").at(-1),
				states: runtimeUpdates.filter((update) => update.type === "state" || update.type === "error"),
				modelHealth: health,
				transcriptToolNames: toolNames,
				controlRequests,
				management: {
					candidateExists,
					validationRaw: safeEvidenceText(validationText),
					updateRaw: safeEvidenceText(updateText),
					validation: validationReceipt
						? Object.fromEntries(
								["valid", "accepted", "saved"].flatMap((key) =>
									key in validationReceipt ? [[key, validationReceipt[key]]] : [],
								),
							)
						: null,
					update: updateReceipt
						? Object.fromEntries(
								["valid", "saved", "accepted", "restartRequired", "revision"].flatMap((key) =>
									key in updateReceipt ? [[key, updateReceipt[key]]] : [],
								),
							)
						: null,
				},
				configurationChecks,
			};
			await persistEvidence(evidence);
			expect(completedData).toMatchObject({ status: "done", model: testModel });
			expect(completedData?.inputs).toContain(receipt.event);
			expect(
				candidateExists,
				`Luna completed without creating the candidate; run=${JSON.stringify({
					status: completedData?.status,
					model: completedData?.model,
					inputs: completedData?.inputs,
					at: completed?.ts,
					receipt: { event: receipt.event, session: receipt.session },
					tools: toolNames,
				})}`,
			).toBe(true);
			const validationResult = validationReceipt as {
				valid: boolean;
				accepted: boolean;
				saved: boolean;
			};
			const updateResult = updateReceipt as {
				valid: boolean;
				saved: boolean;
				accepted: boolean;
				restartRequired: boolean;
				revision: string;
			};
			expect(validationResult).toMatchObject({ valid: true, accepted: false, saved: false });
			expect(updateResult).toMatchObject({ valid: true, saved: true, accepted: true, restartRequired: false });
			expect(updateResult.revision).toMatch(/^[a-f0-9]{64}$/u);
			expect(saved.profiles.owner).toEqual(privateProfile);
			expect(saved.profiles.group).toEqual({ ...before.group, model: testModel });
			expect(saved.bindings).toEqual(agent.bindings);
			expect(saved.defaults).toEqual(agent.defaults);
			const managementActions = controlRequests.map((request) => request.action);
			expect(toolNames).toContain("bash");
			expect(managementActions).toContain("agents.show");
			expect(managementActions).toContain("agents.validate");
			expect(managementActions).toContain("agents.update");
			expect(managementActions).toContain("inspect");

			socket = createConnection(resolve(home, ".yonder/plugins/channel-cli/group-cli.sock"));
			const packets: Array<{ type: string; text?: string; event?: { id: string } }> = [];
			createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
			await new Promise<void>((resolveConnect, reject) => {
				socket?.once("connect", resolveConnect);
				socket?.once("error", reject);
			});
			socket.write(
				`\u001e${JSON.stringify({ type: "input", text: "From the host facts in this request, report the actual selected model and finish with GROUP_PROFILE_RUN_OK. Do not call tools." })}\n`,
			);
			await expect.poll(() => packets.find((packet) => packet.type === "accepted"), { timeout: 10_000 }).toBeTruthy();
			const accepted = packets.find((packet) => packet.type === "accepted");
			if (!accepted?.event) throw new Error("CLI channel did not acknowledge the group-profile input");
			const input = accepted.event;
			await expect
				.poll(
					async () =>
						(await running.events.query({ type: "run.end" })).events.find((event) => event.parent === input.id),
					{ timeout: 120_000, interval: 500 },
				)
				.toBeTruthy();
			const groupRun = (await running.events.query({ type: "run.end" })).events.find(
				(event) => event.parent === input.id || (event.data as { inputs?: string[] }).inputs?.includes(input.id),
			);
			if (!groupRun) throw new Error("Missing group-profile run.end");
			const run = groupRun.data as { session: string; model: string; status?: string; inputs?: string[] };
			const selectedSession = (await running.sessions.list({ agent: "main", open: true })).find(
				(session) => session.id === run.session,
			);
			const final = packets.find(
				(packet) => packet.type === "message" && packet.text?.includes("GROUP_PROFILE_RUN_OK"),
			);
			await persistEvidence({
				...evidence,
				secondRun: {
					event: input.id,
					parent: groupRun.parent,
					inputs: run.inputs,
					status: run.status,
					model: run.model,
					profile: selectedSession?.profile,
					finalAssistant: safeEvidenceText(final?.text ?? ""),
					at: groupRun.ts,
				},
			});
			expect(selectedSession?.profile).toBe("group");
			expect(run).toMatchObject({ status: "done", model: testModel });
			expect(run.inputs).toContain(input.id);
			await expect
				.poll(() =>
					packets.some((packet) => packet.type === "message" && packet.text?.includes("GROUP_PROFILE_RUN_OK")),
				)
				.toBe(true);
			expect(final?.text).toContain(testModel);
		} finally {
			socket?.destroy();
			await stopObserving?.();
			await control?.close();
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	300_000,
);
