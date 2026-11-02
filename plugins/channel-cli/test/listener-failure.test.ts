import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChannelProvider, PluginAPI } from "@yonder/sdk";
import { expect, test, vi } from "vitest";

const transport = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@yonder/sdk/node-ipc", () => ({ createLocalServer: transport.create }));

import plugin from "../src/index.js";

test("late listener error is logged and closes the CLI endpoint and client", async () => {
	const data = await mkdtemp(join(tmpdir(), "yonder-channel-fault-"));
	const socket = new PassThrough();
	const server = Object.assign(new EventEmitter(), {
		listening: true,
		listen: (_options: unknown, ready: () => void) => ready(),
		close: vi.fn((done: () => void) => {
			server.listening = false;
			done();
		}),
	});
	transport.create.mockImplementation((connect) => {
		connect(socket);
		return server;
	});
	let provider!: ChannelProvider;
	const error = vi.fn();
	await plugin.setup({
		paths: { data },
		log: { error },
		channels: {
			register: (value: ChannelProvider) => {
				provider = value;
			},
		},
	} as unknown as PluginAPI);
	const channel = await provider.create("test", {});
	await channel.start({ emit: vi.fn(), ask: vi.fn() });
	try {
		expect(() => server.emit("error", new Error("accept failed"))).not.toThrow();
		await channel.stop();
		expect(error).toHaveBeenCalledWith("CLI channel listener failed", {
			channel: "test",
			error: "Error: accept failed",
		});
		expect(socket.destroyed).toBe(true);
		expect(server.close).toHaveBeenCalledTimes(1);
		expect(await channel.send("conv:test:local", { text: "not delivered" })).toEqual({ ok: false, error: "no client" });
	} finally {
		await channel.stop();
		await rm(data, { recursive: true, force: true });
	}
});
