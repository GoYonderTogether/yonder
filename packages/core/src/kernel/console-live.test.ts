import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

// Real model (repo default test model): the console and the CLI share one main session; each reply goes back to its origin.
const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real model replies cross channels: console and CLI share the main session, replies return to each origin",
	async () => {
		const home = await mkdtemp("/tmp/yonder-console-live-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let socket: Socket | undefined;
		const cli: string[] = [];
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			kernel = await openKernel(home);
			const running = kernel;
			socket = createConnection(`${home}/.yonder/plugins/channel-cli/cli.sock`);
			createInterface({ input: socket }).on("line", (line) => {
				const part = JSON.parse(line) as { type: string; text?: string };
				if (part.type === "final" && part.text) cli.push(part.text);
			});
			await new Promise<void>((done, reject) => {
				socket?.once("connect", done);
				socket?.once("error", reject);
			});
			const sent = await running.bots.send("main", "Reply with exactly: CONSOLE_OK");
			const toConsole = async () =>
				(await running.events.query({ type: "message.out" })).events.filter(
					(event) => (event.data as { to?: string }).to === "conv:console:main",
				);
			await expect.poll(async () => (await toConsole()).length, { timeout: 90_000 }).toBeGreaterThan(0);
			expect((await toConsole()).map((event) => (event.data as { text: string }).text).join("\n")).toContain(
				"CONSOLE_OK",
			);
			socket.write("Reply with exactly: CLI_OK\n");
			await expect.poll(() => cli.some((text) => text.includes("CLI_OK")), { timeout: 90_000 }).toBe(true);
			const inputs = (await running.events.query({ type: "message.in" })).events;
			expect(new Set(inputs.flatMap((event) => event.routes?.map((route) => route.session) ?? []))).toEqual(
				new Set([sent.session]),
			);
			expect(cli.some((text) => text.includes("CONSOLE_OK"))).toBe(false);
			expect((await toConsole()).some((event) => (event.data as { text: string }).text.includes("CLI_OK"))).toBe(false);
		} finally {
			socket?.destroy();
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	200_000,
);
