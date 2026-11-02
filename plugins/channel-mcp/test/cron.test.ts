import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ChannelIO, PluginAPI } from "@yonder/sdk";
import { expect, it, vi } from "vitest";
import { createControlServer } from "../src/operations.js";

it("routes MCP cron management through the owner-authorized host bridge", async () => {
	const ownerViewAct = vi.fn(async () => ({ content: { type: "markdown", text: "[]" } }));
	const server = createControlServer(
		{ id: "channel-mcp" } as PluginAPI,
		{ ownerViewAct } as unknown as ChannelIO,
		"control",
		"owner",
	);
	const client = new Client({ name: "test", version: "1" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	try {
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		const result = await client.callTool({
			name: "channel-mcp_cron_manage",
			arguments: { request: { action: "list" } },
		});
		expect(result.isError).not.toBe(true);
		expect(ownerViewAct).toHaveBeenCalledExactlyOnceWith("cron.manage", "manage", { action: "list" });
	} finally {
		await client.close();
		await server.close();
	}
});
