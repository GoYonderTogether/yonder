import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";

// Inject transport faults only; the product control lifecycle runs unchanged.
const transport = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@yonder/sdk/node-ipc", () => ({ createLocalServer: transport.create }));

import { serveControl } from "./index.js";

test("late listener error closes clients and reports once without an uncaught error", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-control-fault-"));
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
	const report = vi.fn();
	const control = await serveControl(home, async () => null, report);
	try {
		const failure = new Error("accept failed");
		expect(() => server.emit("error", failure)).not.toThrow();
		server.emit("error", failure);
		await expect.poll(() => report.mock.calls.length).toBe(1);
		expect(report).toHaveBeenCalledWith(failure);
		expect(socket.destroyed).toBe(true);
		await control.close();
		expect(server.close).toHaveBeenCalledTimes(1);
	} finally {
		await control.close();
		await rm(home, { recursive: true, force: true });
	}
});
