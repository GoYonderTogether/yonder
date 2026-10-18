import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../kernel/index.js";
import { FileCredentials } from "../runtime/credentials.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const data = (result: Awaited<ReturnType<Client["callTool"]>>) => {
	assert(!result.isError, JSON.stringify(result));
	assert(Array.isArray(result.content));
	const block = result.content[0];
	assert(block?.type === "text");
	return JSON.parse(block.text);
};

async function setup(real = false) {
	const home = await mkdtemp("/tmp/yonder-mcp-");
	await initHome(home);
	const token = randomBytes(32).toString("base64url");
	const credential = `n02-mcp-${randomUUID()}`;
	const credentials = new FileCredentials(real ? auth : `${home}/.yonder/auth.json`);
	await credentials.modify(credential, async () => ({ type: "api_key", key: token }));
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	const client = new Client({ name: "codex-yonder-verification", version: "1" });
	const close = async () => {
		try {
			await client.close();
			await kernel?.close();
		} finally {
			await credentials.delete(credential);
			await rm(home, { recursive: true, force: true });
		}
	};
	try {
		const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
		config.plugins.push({ use: "@yonder/plugin-channel-mcp" });
		config.channels.control = { type: "mcp", port: 0, credential, account: "codex" };
		config.identity.persons[0].accounts.push("acct:control:codex");
		if (real) {
			config.credentials = auth;
			const file = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(file, "utf8"));
			agent.bindings.unshift({
				id: "control",
				match: { channel: "control", kind: "dm", from: "owner" },
				session: "main",
				profile: "owner",
				reply: "none",
			});
			agent.profiles.owner.tools = { offer: ["bash"] };
			agent.profiles.owner.limits = { maxMinutes: 1 };
			await writeFile(file, stringify(agent));
		}
		await writeFile(`${home}/yonder.yaml`, stringify(config));
		let port = 0;
		kernel = await openKernel(home, {
			log: (_level, message, value) => {
				if (message === "MCP listening") port = (value as { address: { port: number } }).address.port;
			},
		});
		assert(port);
		const url = new URL(`http://127.0.0.1:${port}/mcp`);
		await client.connect(
			new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }) as Transport,
		);
		const call = (name: string, args: Record<string, unknown> = {}) =>
			client.callTool({ name: `channel-mcp_${name}`, arguments: args });
		return { client, call, token, url, home, close };
	} catch (error) {
		await close();
		throw error;
	}
}

test("standard MCP client discovers native APIs and rejects forged identities, facts, hosts and origins", async () => {
	const connection = await setup();
	try {
		const names = (await connection.client.listTools()).tools.map((tool) => tool.name);
		expect(names).toHaveLength(18);
		expect(names.some((name) => /credentials|login|services/u.test(name))).toBe(false);
		const event = data(
			await connection.call("events_emit", {
				event: { type: "message.in", conversation: "verification", data: { text: "N02 MCP source verification" } },
			}),
		);
		expect([event.from, event.conv]).toEqual(["acct:control:codex", "conv:control:verification"]);
		expect(event.routes[0].dropped).toBe("no-binding");
		expect(
			(
				await connection.call("events_emit", {
					event: { type: "message.in", from: "acct:cli:local", data: { text: "N02 forged source check" } },
				})
			).isError,
		).toBe(true);
		expect((await connection.call("events_emit", { event: { type: "run.end", data: {} } })).isError).toBe(true);
		expect(data(await connection.call("identity_relation", { agent: "main", account: "acct:control:codex" }))).toBe(
			"owner",
		);
		expect((await fetch(connection.url)).status).toBe(401);
		expect(
			(
				await fetch(connection.url, {
					headers: { Authorization: `Bearer ${connection.token}`, Origin: "https://untrusted.invalid" },
				})
			).status,
		).toBe(403);
		const status = await new Promise<number | undefined>((accept, reject) => {
			request(
				connection.url,
				{ headers: { Host: "untrusted.invalid", Authorization: `Bearer ${connection.token}` } },
				(response) => {
					response.resume();
					accept(response.statusCode);
				},
			)
				.on("error", reject)
				.end();
		});
		expect(status).toBe(403);
	} finally {
		await connection.close();
	}
}, 20000);

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"MCP controls real Luna, observes its native result, cancels waiting and explicitly aborts",
	async () => {
		const connection = await setup(true);
		try {
			const ask = data(
				await connection.call("events_ask", {
					event: {
						type: "message.in",
						data: { text: "Call bash once with command: printf yonder-mcp-ready. Then reply with its output." },
					},
				}),
			);
			expect(ask.results[0]).toMatchObject({ status: "done" });
			expect(ask.results[0].text).toContain("yonder-mcp-ready");
			const session = ask.results[0].session;
			const entries = data(await connection.call("sessions_transcript", { id: session }));
			expect(
				entries.some((entry: { tools?: Array<{ name: string }> }) => entry.tools?.some((tool) => tool.name === "bash")),
			).toBe(true);
			const stop = new AbortController();
			const pending = connection.client.callTool(
				{
					name: "channel-mcp_events_ask",
					arguments: {
						event: {
							type: "message.in",
							data: {
								text: "Call bash once with command: sleep 3; printf yonder-mcp-continue. Then reply with its output.",
							},
						},
					},
				},
				undefined,
				{ signal: stop.signal },
			);
			const eventQuery = async () =>
				data(
					await connection.call("events_query", {
						query: { type: "message.in", from: "acct:control:codex", after: ask.event.id },
					}),
				);
			await expect.poll(async () => (await eventQuery()).events.length, { timeout: 15000 }).toBe(1);
			const accepted = (await eventQuery()).events[0];
			stop.abort();
			await expect(pending).rejects.toBeDefined();
			const ended = async (parent: string) =>
				data(await connection.call("events_query", { query: { type: "run.end", after: parent } })).events.find(
					(event: { parent: string }) => event.parent === parent,
				);
			await expect.poll(async () => (await ended(accepted.id))?.data.status, { timeout: 45000 }).toBe("done");
			const event = data(
				await connection.call("events_emit", {
					event: {
						type: "message.in",
						data: { text: "Call bash once with command: sleep 20; printf yonder-mcp-abort. Then report it." },
					},
				}),
			);
			await expect
				.poll(
					async () =>
						data(await connection.call("sessions_transcript", { id: session })).some(
							(entry: { tools?: Array<{ args: object }> }) =>
								entry.tools?.some((tool) => JSON.stringify(tool.args).includes("mcp-abort")),
						),
					{ timeout: 30000 },
				)
				.toBe(true);
			data(await connection.call("sessions_abort", { id: session }));
			await expect.poll(async () => (await ended(event.id))?.data.status, { timeout: 15000 }).toBe("aborted");
		} finally {
			await connection.close();
		}
	},
	150000,
);
