import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { requestControl, serveControl } from "./index.js";

const homes: string[] = [];
afterEach(async () => Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))));

test("control socket exchanges one JSON line and returns handler errors", async () => {
	const home = await mkdtemp(join(tmpdir(), "yctl-"));
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
