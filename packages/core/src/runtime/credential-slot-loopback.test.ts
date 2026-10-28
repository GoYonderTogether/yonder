import { once } from "node:events";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { CredentialSlotStore } from "./credential-slots.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

it("actual HTTP retry keeps the frozen account across a host configuration change", async () => {
	const home = mkdtempSync(join(realpathSync(tmpdir()), "yonder-slot-http-"));
	let selected = "a";
	const authorization: Array<string | undefined> = [];
	const server = createServer((request, response) => {
		authorization.push(request.headers.authorization);
		selected = "b";
		request.resume();
		response.writeHead(503, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: { message: "loopback unavailable", type: "server_error" } }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing loopback address");
	const slots = new CredentialSlotStore(join(home, "auth.json"));
	for (const slot of ["a", "b"])
		await slots.commitLogin(await slots.beginLogin("openai", slot), { type: "api_key", key: `fixture-${slot}` });
	let runtime: Runtime | undefined;
	try {
		runtime = await Runtime.open({
			home,
			db: await openDatabase(join(home, "state.db")),
			config: {
				schema: 1,
				credentials: "auth.json",
				retry: { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1 },
				models: { providers: { openai: { baseUrl: `http://127.0.0.1:${address.port}/v1` } } },
			},
			resolveSession: async () => ({
				agent: null,
				profile: "test",
				cwd: home,
				resolved: resolveProfile({ credentialSlots: { openai: selected }, capabilities: [], tools: { offer: [] } }),
			}),
		});
		const session = await runtime.create({ agent: null, profile: "test", cwd: home });
		const result = await runtime.submit(session, { text: "loopback failure identity probe" });
		expect(result.status).toBe("error");
		expect(authorization).toEqual(["Bearer fixture-a", "Bearer fixture-a"]);
		expect(result.config?.resolved.credentialSlots).toEqual({ openai: "a" });
		expect(result.config?.credentialGenerations?.openai).toMatch(/^[0-9a-f-]{36}$/);
	} finally {
		await runtime?.close();
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
		rmSync(home, { recursive: true, force: true });
	}
});
