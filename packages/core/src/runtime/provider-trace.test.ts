import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, CredentialStore, Model } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import { enableProviderTrace, traceCredentials, traceModel } from "./provider-trace.js";

test("provider trace is opt-in, redacts credentials and records SSE", async () => {
	const directory = mkdtempSync(join(tmpdir(), "yonder-trace-"));
	delete process.env.YONDER_PROVIDER_TRACE;
	expect(enableProviderTrace()).toBe(false);
	expect(readdirSync(directory)).toEqual([]);
	writeFileSync(join(directory, "old.jsonl"), "old");
	utimesSync(join(directory, "old.jsonl"), new Date(0), new Date(0));
	const original = globalThis.fetch;
	const server = createServer((_req, res) => {
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.write("data: sk-abcdefgh");
		res.end("ijkl credential-secret\n\n");
	}).listen(0, "127.0.0.1");
	await new Promise<void>((resolve) => server.once("listening", resolve));
	try {
		process.env.YONDER_PROVIDER_TRACE = directory;
		enableProviderTrace();
		const port = (server.address() as { port: number }).port;
		traceModel({ api: "openai-completions", baseUrl: `http://127.0.0.1:${port}/v1` } as Model<Api>);
		const store = {
			read: async () => ({ type: "api_key", key: "credential-secret", env: { TOKEN: "env-secret" } }),
		} as unknown as CredentialStore;
		await traceCredentials(store).read("test");
		const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
			method: "POST",
			headers: {
				authorization: "Bearer headersecret",
				"x-api-key": "headerkey",
				"api-key": "anotherkey",
				cookie: "cookiesecret",
				"x-goog-api-key": "googsecret",
			},
			body: "sk-abcdefghijk Bearer bodysecret credential-secret env-secret",
		});
		await response.text();
		await new Promise((resolve) => setTimeout(resolve, 30));
		const files = readdirSync(directory);
		expect(files).toHaveLength(1);
		expect(statSync(directory).mode & 0o777).toBe(0o700);
		expect(statSync(join(directory, files[0]!)).mode & 0o777).toBe(0o600);
		const content = readFileSync(join(directory, files[0]!), "utf8");
		for (const secret of [
			"headersecret",
			"headerkey",
			"anotherkey",
			"cookiesecret",
			"googsecret",
			"sk-abcdefghijk",
			"bodysecret",
			"credential-secret",
			"env-secret",
		])
			expect(content).not.toContain(secret);
		expect(content).toContain('"type":"sse"');
		expect(content).toContain("data: [REDACTED]");
	} finally {
		globalThis.fetch = original;
		delete process.env.YONDER_PROVIDER_TRACE;
		server.close();
	}
});
