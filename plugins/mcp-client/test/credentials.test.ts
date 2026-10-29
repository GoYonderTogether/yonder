import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

/** Run one `connect` whose header credential resolves to `credential`; the error is returned, not thrown. */
async function connectWith(credential: unknown) {
	const dir = await mkdtemp(join(tmpdir(), "mcp-client-credentials-"));
	try {
		const collector = createRegistrationCollector();
		const api = {
			...collector.api,
			config: {},
			paths: { data: join(dir, "state") },
			credentials: { get: async () => credential },
		};
		await plugin.setup(api as never);
		const tool = collector.registrations.tools.find((entry) => entry.name === "mcp-client_http");
		if (!tool) throw new Error("missing mcp-client_http tool");
		const ctx = {
			session: "credentials",
			signal: new AbortController().signal,
			capabilities: ["read", "write", "message", "network"],
			env: { id: "node:local" },
		} as unknown as ToolContext;
		const result = (await tool.execute(
			{
				action: "connect",
				server: "example",
				config: {
					transport: "http",
					url: "https://example.com/mcp",
					headerCredentials: { authorization: "example-token" },
				},
			},
			ctx,
		)) as { text: string; isError?: boolean };
		return result;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const errorOf = (result: { text: string }) => (JSON.parse(result.text) as { error: string }).error;

test("an unregistered credential reference names the reference and how to store it", async () => {
	const result = await connectWith(undefined);
	expect(result.isError).toBe(true);
	const error = errorOf(result);
	expect(error).toContain('MCP credential "example-token" is not registered');
	expect(error).toContain("yonder credentials set <name> --home <home>");
});

test("an OAuth login is reported as unusable rather than as a missing api_key", async () => {
	const error = errorOf(await connectWith({ type: "oauth", refresh: "refresh", access: "access", expires: 0 }));
	expect(error).toContain('MCP credential "example-token" is an OAuth login');
	expect(error).toContain("store the resulting access token as a named API key");
});

test("an API key without a value says how to re-store that exact reference", async () => {
	const error = errorOf(await connectWith({ type: "api_key" }));
	expect(error).toContain('MCP credential "example-token" is an API key with no value');
	expect(error).toContain("yonder credentials set example-token --home <home>");
});
