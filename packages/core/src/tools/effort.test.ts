import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { clampThinkingLevel } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "../kernel/index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real agent_ask applies a per-run effort for admin callers only, records the decision and never leaks to later runs",
	async () => {
		const home = await mkdtemp("/tmp/yonder-effort-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		const sockets: Socket[] = [];
		const clients: Array<{ channel: string; packets: Array<{ type: string; text?: string; event?: YEvent }> }> = [];
		try {
			await initHome(home, "owner", { model: testModel });
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.channels.plain = { type: "cli" };
			config.identity.persons[0].accounts.push("acct:plain:local");
			config.agents.push({ id: "helper", workspace: "./agents/helper" });
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const file = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(file, "utf8"));
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: ["agent_ask"] };
			agent.profiles.owner.limits = { maxMinutes: 2 };
			agent.profiles.plain = { level: "standard", tools: { offer: ["agent_ask"] } };
			agent.bindings.find((binding: { id: string }) => binding.id === "owner")!.stream = false;
			agent.bindings.push({
				id: "plain",
				match: { channel: "plain", kind: "dm", from: "owner" },
				session: { mode: "persistent", per: "conv" },
				profile: "plain",
				stream: false,
			});
			await writeFile(file, stringify(agent));
			await mkdir(`${home}/agents/helper`);
			await writeFile(
				`${home}/agents/helper/agent.yaml`,
				stringify({
					schema: 1,
					id: "helper",
					name: "helper",
					owner: "person:owner",
					defaultProfile: "answer",
					profiles: {
						answer: {
							model: "openai/gpt-6-luna",
							thinking: "medium",
							level: "readonly",
							tools: { offer: [], search: [] },
						},
					},
					bindings: [
						{
							id: "internal",
							match: { channel: "agent", kind: "agent" },
							session: { mode: "persistent", per: "conv" },
							profile: "answer",
							reply: "none",
						},
					],
				}),
			);
			kernel = await openKernel(home);
			const running = kernel;
			const connect = async (channel: string) => {
				const socket = createConnection(`${home}/.yonder/plugins/channel-cli/${channel}.sock`);
				sockets.push(socket);
				const packets: Array<{ type: string; text?: string; event?: YEvent }> = [];
				clients.push({ channel, packets });
				createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
				await new Promise<void>((done, reject) => {
					socket.once("connect", done);
					socket.once("error", reject);
				});
				return { socket, packets };
			};
			const [cli, plain] = await Promise.all([connect("cli"), connect("plain")]);
			const submit = async (client: typeof cli, text: string) => {
				const start = client.packets.length;
				client.socket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
				await expect
					.poll(() => client.packets.slice(start).find((p) => p.type === "accepted"), { timeout: 5000 })
					.toBeTruthy();
				const event = client.packets.slice(start).find((p) => p.type === "accepted")!.event!;
				await expect
					.poll(
						async () =>
							(await running.events.query({ type: "run.end", after: event.id })).events.find(
								(e) => e.parent === event.id,
							),
						{ timeout: 120000 },
					)
					.toBeTruthy();
				await expect
					.poll(() => client.packets.slice(start).find((p) => p.type === "message"), { timeout: 5000 })
					.toBeTruthy();
				return { event, text: client.packets.slice(start).find((p) => p.type === "message")!.text! };
			};
			const helperRuns = async () =>
				(await running.events.query({ type: "run.end" })).events.filter(
					(e) => (e.data as { model?: string }).model === "openai/gpt-6-luna" && e.conv === "conv:agent:main",
				);
			const ask = (effort: string | undefined) =>
				`Call agent_ask exactly once with agent helper, text "Reply with the single word PONG."${
					effort === undefined ? ", and do NOT pass an effort argument at all" : `, effort "${effort}"`
				}. Then reply with the helper's answer.`;
			const luna = getBuiltinModel("openai", "gpt-6-luna");
			const expectHigh = clampThinkingLevel(luna, "xhigh");

			const low = await submit(cli, ask("low"));
			expect(low.text).toMatch(/PONG/u);
			let runs = await helperRuns();
			expect(runs).toHaveLength(1);
			expect(runs[0]!.data).toMatchObject({
				thinking: "low",
				effort: { requested: "low", effective: "low" },
			});
			expect((runs[0]!.data as { effort: { reason?: string } }).effort.reason).toBeUndefined();

			// A later plain delegation to the same persistent helper session returns to the profile default.
			await submit(cli, ask(undefined));
			runs = await helperRuns();
			expect(runs).toHaveLength(2);
			// The model chose not to pass effort this time, so the kernel must not carry the previous request over.
			const plainAsk = (await running.events.query({ type: "message.in" })).events.filter(
				(e) => e.conv === "conv:agent:main",
			)[1]!;
			expect(plainAsk.data).not.toHaveProperty("effort");
			expect(runs[1]!.data).toMatchObject({ thinking: "medium" });
			expect(runs[1]!.data).not.toHaveProperty("effort");

			// Unsupported levels follow pi's deterministic clamp and say so.
			await submit(cli, ask("xhigh"));
			runs = await helperRuns();
			expect(runs[2]!.data).toMatchObject({
				thinking: expectHigh,
				effort: { requested: "xhigh", effective: expectHigh },
			});
			if (expectHigh !== "xhigh")
				expect((runs[2]!.data as { effort: { reason: string } }).effort.reason).toBe("unsupported-level");

			// An invalid string falls back to the profile default and records why.
			await submit(cli, ask("ultra-deep"));
			runs = await helperRuns();
			expect(runs[3]!.data).toMatchObject({
				thinking: "medium",
				effort: { requested: "ultra-deep", effective: "medium", reason: "invalid-level" },
			});

			// A caller without admin is refused: the tool errors and no delegation with an effort is ever created. The model
			// may then retry without effort (a plain delegation is fine), so assert on what reached the kernel.
			const before = (await running.events.query({ type: "message.in" })).events.filter(
				(e) => e.conv === "conv:agent:main",
			).length;
			const denied = await submit(plain, ask("high"));
			const session = denied.event.routes?.find((r) => r.session)?.session;
			if (!session) throw new Error("Missing plain session");
			const transcript = await running.sessions.transcript(session);
			expect(transcript.some((entry) => entry.kind === "pi.tool-result" && /admin/u.test(entry.text))).toBe(true);
			const created = (await running.events.query({ type: "message.in" })).events
				.filter((e) => e.conv === "conv:agent:main")
				.slice(before);
			expect(created.every((e) => !Object.hasOwn(e.data, "effort"))).toBe(true);
		} finally {
			try {
				const directory = process.env.YONDER_TEST_EVIDENCE_DIR;
				if (kernel && (directory || process.env.YONDER_KEEP_TEST_HOME === "1")) {
					const running = kernel;
					const events: YEvent[] = [];
					let after: string | undefined;
					do {
						const page = await running.events.query({ limit: 1000, ...(after ? { after } : {}) });
						events.push(...page.events);
						after = page.next;
					} while (after);
					const sessions = await running.sessions.list({});
					const transcripts = await Promise.all(
						sessions.map(async (session) => ({
							session: session.id,
							entries: await running.sessions.transcript(session.id, { limit: 1000 }),
						})),
					);
					const output = resolve(directory ?? home, `${basename(home)}-evidence.json`);
					await mkdir(directory ?? home, { recursive: true });
					await writeFile(output, JSON.stringify({ home, clients, events, sessions, transcripts }, null, 2));
					console.log(`Effort test evidence: ${output}`);
				}
			} finally {
				for (const socket of sockets) socket.destroy();
				await kernel?.close();
				if (process.env.YONDER_KEEP_TEST_HOME !== "1") await rm(home, { recursive: true, force: true });
			}
		}
	},
	420000,
);
