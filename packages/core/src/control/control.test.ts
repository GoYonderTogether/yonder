import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { cliChannelEndpoint, controlEndpoint, observeControl, requestControl, serveControl } from "./index.js";

test("Windows local endpoints are stable named pipes and keep homes/channels separate", () => {
	const first = controlEndpoint("C:\\Users\\Ada\\Yonder", "win32");
	expect(first).toMatch(/^\\\\\.\\pipe\\yonder-control-[a-f0-9]{32}$/u);
	expect(first).toBe(controlEndpoint("c:\\users\\ada\\yonder", "win32"));
	expect(first).not.toBe(controlEndpoint("C:\\Users\\Ada\\Another", "win32"));
	expect(cliChannelEndpoint("C:\\Users\\Ada\\Yonder", "cli", "win32")).not.toBe(
		cliChannelEndpoint("C:\\Users\\Ada\\Yonder", "other", "win32"),
	);
});

const homes: string[] = [];
afterEach(async () => Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))));

test("control socket exchanges one JSON line and returns handler errors", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	homes.push(home);
	const server = await serveControl(home, async (request) => {
		if (request.method === "fail") throw new Error("expected failure");
		return { method: request.method, params: request.params };
	});
	try {
		expect(await requestControl(home, { method: "echo", params: { id: "7" } })).toEqual({
			method: "echo",
			params: { id: "7" },
		});
		await expect(requestControl(home, { method: "fail" })).rejects.toThrow("expected failure");
	} finally {
		await server.close();
	}
});

test("missing control socket rejects normally so CLI can use offline queries", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	homes.push(home);
	await expect(requestControl(home, { method: "sessions.list" })).rejects.toMatchObject({ code: "ENOENT" });
});

test("stream acknowledges before queued updates and releases observer on disconnect", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	homes.push(home);
	let disconnected = false;
	const server = await serveControl(home, async (_request, connection) => {
		connection.signal.addEventListener("abort", () => {
			disconnected = true;
		});
		await connection.send({ type: "snapshot", running: false });
		return { subscribed: true };
	});
	try {
		const updates: unknown[] = [];
		const stream = await observeControl(home, { method: "watch" }, (value) => updates.push(value));
		expect(stream.result).toEqual({ subscribed: true });
		await expect.poll(() => updates.length).toBe(1);
		expect(updates[0]).toEqual({ type: "snapshot", running: false });
		stream.close();
		await expect.poll(() => disconnected).toBe(true);
	} finally {
		await server.close();
	}
});
