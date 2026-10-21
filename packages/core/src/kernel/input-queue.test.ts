import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { OutputPart, SessionUpdate, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
for (const scenario of ["generation", "tools", "interrupt"] as const) {
	test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
		`real Luna merges all queued inputs in one run during ${scenario}`,
		async () => {
			const home = await mkdtemp("/tmp/yonder-input-queue-");
			let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
			const sockets: Socket[] = [];
			const updates: SessionUpdate[] = [];
			let stop: (() => Promise<void>) | undefined;
			const packets: Array<OutputPart | { type: "accepted"; event: YEvent }> = [];
			try {
				await initHome(home);
				const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
				config.credentials = auth;
				config.channels.interrupt = { type: "cli" };
				config.identity.persons[0].accounts.push("acct:interrupt:local");
				await writeFile(`${home}/yonder.yaml`, stringify(config));
				const path = `${home}/agents/main/agent.yaml`;
				const agent = parse(await readFile(path, "utf8"));
				agent.defaults.contexts = [];
				agent.profiles.owner.model = "openai/gpt-6-luna";
				agent.profiles.owner.tools = { offer: scenario === "generation" ? [] : ["bash"], search: [] };
				delete agent.bindings[0].busy;
				agent.bindings[0].stream = true;
				agent.bindings.unshift({
					...agent.bindings[0],
					id: "interrupt",
					match: { channel: "interrupt", from: "owner" },
					busy: "interrupt",
				});
				await writeFile(path, stringify(agent));
				kernel = await openKernel(home);
				const running = kernel;
				const connect = async (channel: string) => {
					const socket = createConnection(`${home}/.yonder/plugins/channel-cli/${channel}.sock`);
					sockets.push(socket);
					createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
					await new Promise<void>((done, reject) => {
						socket.once("connect", done);
						socket.once("error", reject);
					});
					return socket;
				};
				const cli = await connect("cli");
				const interrupt = await connect("interrupt");
				const send = (socket: Socket, text: string) =>
					socket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
				send(
					cli,
					scenario === "generation"
						? "Input A. Without tools, write a very long detailed explanation of how event queues work, at least 2000 words. Start with QUEUE_OLD."
						: `Input A. Say QUEUE_PROGRESS, then call bash exactly once with command "sleep ${scenario === "interrupt" ? 25 : 3}; printf QUEUE_TOOL_DONE". Keep the tool in the foreground. After the tool, answer any further user inputs without calling another tool.`,
				);
				await expect.poll(() => packets.some((p) => p.type === "accepted"), { timeout: 5000 }).toBe(true);
				const accepted = packets.find((p) => p.type === "accepted");
				if (accepted?.type !== "accepted") throw new Error("Missing acceptance");
				const session = accepted.event.routes?.find((r) => r.session)?.session;
				if (!session) throw new Error("Missing session");
				stop = await running.sessions.observe(session, async (update) => {
					updates.push(update);
				});
				await expect
					.poll(
						() =>
							scenario === "generation"
								? packets.some((p) => p.type === "text")
								: updates.some((p) => p.type === "tool" && p.tool?.phase === "start"),
						{ timeout: 60000 },
					)
					.toBe(true);
				send(
					scenario === "interrupt" ? interrupt : cli,
					"Input B replaces the requested final answer. Do not call any more tools. After reading all queued inputs including Input C, reply exactly QUEUE_MERGED_A_B_C. No other text.",
				);
				send(cli, "Input C. Final answer must be exactly QUEUE_MERGED_A_B_C. No more tools and no long explanation.");
				await expect
					.poll(async () => (await running.events.query({ type: "run.end" })).events.length, { timeout: 90000 })
					.toBe(1);
				const ends = (await running.events.query({ type: "run.end" })).events;
				const data = ends[0]!.data as { inputs: string[]; status: string };
				expect(data.inputs).toHaveLength(3);
				expect(data.status).toBe("done");
				await expect
					.poll(() => packets.some((p) => p.type === "final" && p.text.includes("QUEUE_MERGED_A_B_C")), {
						timeout: 5000,
					})
					.toBe(true);
				const messages = (await running.events.query({ type: "message.out" })).events;
				expect(messages.filter((e) => (e.data as { text: string }).text.includes("QUEUE_MERGED_A_B_C"))).toHaveLength(
					scenario === "interrupt" ? 2 : 1,
				);
				expect(messages.some((e) => (e.data as { text: string }).text.startsWith("QUEUE_OLD"))).toBe(false);
				if (scenario !== "generation") {
					expect(updates.filter((p) => p.type === "tool" && p.tool?.phase === "start")).toHaveLength(1);
					const ended = updates.find((p) => p.type === "tool" && p.tool?.phase === "end")?.tool?.result as
						| { isError?: boolean }
						| undefined;
					expect(ended?.isError).toBe(scenario === "interrupt");
				}
			} finally {
				if (kernel) {
					const ends = (await kernel.events.query({ type: "run.end" })).events;
					const messages = (await kernel.events.query({ type: "message.out" })).events;
					await writeFile(
						`${home}/evidence.json`,
						JSON.stringify({ scenario, packets, updates, ends, messages }, null, 2),
					);
					console.log(`Queue evidence: ${home}/evidence.json`);
				}
				await stop?.();
				for (const socket of sockets) socket.destroy();
				await kernel?.close();
				if (process.env.YONDER_KEEP_TEST_HOME !== "1") await rm(home, { recursive: true, force: true });
			}
		},
		180000,
	);
}
