import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { ChannelProvider, PluginAPI } from "@yonder/sdk";
import { localIpcPath } from "@yonder/sdk";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, it } from "vitest";

it("passes plugin contracts and exchanges messages over its Unix socket", async () => {
	const root = process.cwd();
	expect(await checkPlugin(resolve(root, "plugins/channel-cli"))).toEqual([]);
	expect(await checkPlugin(resolve(root, "plugins/context-files"))).toEqual([]);

	const data = await mkdtemp(join(tmpdir(), "yonder-channel-cli-"));
	let provider!: ChannelProvider;
	const plugin = (await import("../src/index.js")).default;
	await plugin.setup({
		paths: { data },
		channels: {
			register: (channel) => {
				provider = channel;
			},
		},
	} as unknown as PluginAPI);
	const channel = await provider.create("test-cli", {});
	let received!: (event: unknown) => void;
	const input = new Promise<unknown>((resolveInput) => {
		received = resolveInput;
	});
	const stale = spawn(process.execPath, [
		"--input-type=module",
		"-e",
		'import {createServer} from "node:net"; createServer().listen(process.argv[1], () => console.log("ready"));',
		localIpcPath(join(data, "test-cli.sock")),
	]);
	await new Promise<void>((done) => stale.stdout.once("data", () => done()));
	const exited = new Promise<void>((done) => stale.once("exit", () => done()));
	stale.kill("SIGKILL");
	await exited;
	await channel.start({
		emit: async (event) => {
			received(event);
			return { ...event, id: "1", ts: new Date().toISOString() };
		},
		ask: async () => {
			throw new Error("unused");
		},
	});

	const socket = createConnection(localIpcPath(join(data, "test-cli.sock")));
	socket.setEncoding("utf8");
	const lines = createInterface({ input: socket, crlfDelay: Infinity });
	await new Promise<void>((resolveConnect, reject) => {
		socket.once("connect", resolveConnect);
		socket.once("error", reject);
	});
	const line = (async () => {
		for await (const value of lines) return JSON.parse(value) as Record<string, unknown>;
		throw new Error("socket closed before a response");
	})();
	socket.write("hello\n");
	expect(await input).toMatchObject({
		type: "message.in",
		from: "acct:test-cli:local",
		conv: "conv:test-cli:local",
		data: { kind: "dm", text: "hello" },
	});
	expect(await channel.send("conv:test-cli:local", { text: "reply" })).toEqual({ ok: true });
	expect(await line).toEqual({ type: "message", text: "reply" });

	const multiline = new Promise<unknown>((resolveInput) => {
		received = resolveInput;
	});
	const ack = new Promise<Record<string, unknown>>((resolveAck) =>
		socket.once("data", (chunk) => resolveAck(JSON.parse(String(chunk).split("\n")[0] ?? ""))),
	);
	socket.write(`\u001e${JSON.stringify({ type: "input", text: "第一行\nsecond line" })}\n`);
	expect(await multiline).toMatchObject({ data: { kind: "dm", text: "第一行\nsecond line" } });
	expect((await ack).type).toBe("accepted");

	const second = createConnection(localIpcPath(join(data, "test-cli.sock")));
	second.setEncoding("utf8");
	const secondLines = createInterface({ input: second, crlfDelay: Infinity });
	const rejection = (async () => {
		for await (const value of secondLines) return JSON.parse(value) as Record<string, unknown>;
		throw new Error("second client closed before receiving an error");
	})();
	expect(await rejection).toEqual({ type: "error", message: "client already connected" });
	await channel.stop();
	lines.close();
	secondLines.close();
	socket.destroy();
	second.destroy();
	await rm(data, { recursive: true, force: true });
});
