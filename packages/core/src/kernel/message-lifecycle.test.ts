import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { OutputPart, YEvent } from "@yonder/sdk";
import { localIpcPath } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna closes progress bubbles before long tools and automatically delivers background completion",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-message-live-"));
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let socket: Socket | undefined;
		const packets: Array<{ at: number; part: OutputPart }> = [];
		const events: YEvent[] = [];
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const path = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(path, "utf8"));
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: ["bash", "process"] };
			await writeFile(path, stringify(agent));
			kernel = await openKernel(home);
			const running = kernel;
			socket = createConnection(localIpcPath(`${home}/.yonder/plugins/channel-cli/cli.sock`));
			createInterface({ input: socket }).on("line", (line) => {
				packets.push({ at: Date.now(), part: JSON.parse(line) });
			});
			await new Promise<void>((done, reject) => {
				socket!.once("connect", done);
				socket!.once("error", reject);
			});
			// One input only. End the first run while the real tool is detached, so
			// the background completion must start its own streamed follow-up.
			socket.write(
				'Execute the complete workflow below. M43_START must be commentary in the same assistant message that calls bash, never a final answer. Do not end the initial response before actually starting the background tool. Say M43_START and call bash exactly once with command "sleep 18; printf M43_TOOL_DONE" and background:true. After it returns running, say M43_WAITING and end your response; do not poll process. When the automatic background completion arrives, say M43_RESUMED as ordinary text, call bash with command "printf M43_CHECKED", then finish with M43_FINAL. Never ask for another user input.\n',
			);
			await expect
				.poll(() => packets.filter((p) => p.part.type === "final").length, { timeout: 90000 })
				.toBeGreaterThanOrEqual(2);
			await expect
				.poll(() => packets.some((p) => p.part.type === "final" && p.part.text.includes("M43_FINAL")), {
					timeout: 90000,
				})
				.toBe(true);
			const finals = packets.filter((p) => p.part.type === "final");
			const begin = finals.find((p) => p.part.type === "final" && p.part.text.includes("M43_START"));
			expect(begin).toBeTruthy();
			events.push(...(await running.events.query({ limit: 1000 })).events);
			const background = events.find((e) => e.type === "runtime.tool-result");
			expect(background).toBeTruthy();
			expect(begin!.at).toBeLessThan(Date.parse(background!.ts));
			expect(finals.some((p) => p.part.type === "final" && p.part.text.includes("M43_RESUMED"))).toBe(true);
			expect(finals.filter((p) => p.part.type === "final" && p.part.text.includes("M43_FINAL"))).toHaveLength(1);
			expect(events.filter((e) => e.type === "message.in")).toHaveLength(1);
			await expect
				.poll(async () => (await running.events.query({ type: "message.out" })).events.length, { timeout: 5000 })
				.toBe(finals.length);
			await writeFile(`${home}/evidence.json`, JSON.stringify({ packets, events }, null, 2));
			console.log(`M43 real model evidence: ${home}/evidence.json`);
		} finally {
			socket?.destroy();
			await kernel?.close();
			// Keep successful evidence; failed homes remain available for diagnosis.
			await rm(`${home}/.yonder/auth.json`, { force: true });
		}
	},
	180000,
);
