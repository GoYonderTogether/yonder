import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { refreshCloudModels } from "./cloud-models.js";

test("cloud catalog failures are actionable and never expose credentials or response bodies", async () => {
	const home = await tempHome("ya-cloud-catalog-");
	const token = randomUUID();
	const server = createServer((request, response) => {
		expect(request.headers.authorization).toBe(`Bearer ${token}`);
		response.writeHead(503);
		response.end(`private upstream diagnostic ${token}`);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing listener");
	const endpoint = `http://127.0.0.1:${address.port}`;
	const config = { schema: 1 as const, channels: { card: { type: "card", endpoint } } };
	try {
		const missing = await refreshCloudModels(home, config);
		expect(missing.issues[0]?.code).toBe("not_connected");
		const dir = join(home, ".yonder/plugins/channel-card");
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "card.json"), JSON.stringify({ endpoint, token }), { mode: 0o600 });
		const failure = await refreshCloudModels(home, config);
		expect(failure.providers).toEqual({});
		expect(failure.issues).toMatchObject([{ instance: "card", code: "http_error" }]);
		expect(failure.issues[0]?.message).toContain("503");
		expect(JSON.stringify(failure.issues)).not.toContain(token);
	} finally {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		await rm(home, { recursive: true, force: true });
	}
});
