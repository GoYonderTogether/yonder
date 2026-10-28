import { timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { defineChannel, definePlugin } from "@yonder/sdk";
import { type Static, Type } from "typebox";
import { createControlServer } from "./operations.js";

const Config = Type.Object(
	{
		port: Type.Integer({ minimum: 0, maximum: 65535 }),
		credential: Type.String({ minLength: 1 }),
		account: Type.String({ pattern: "^\\S+$" }),
		origins: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	},
	{ additionalProperties: false },
);

export default definePlugin({
	setup(api) {
		api.channels.register(
			defineChannel({
				type: "mcp",
				configSchema: Config,
				create(id, value) {
					const config = value as Static<typeof Config>;
					let server: Server | undefined;
					const clients = new Set<McpServer>();
					return {
						id,
						kinds: ["dm"],
						output: { stream: false, attachments: false },
						features: { identity: "account", streamMode: "none" },
						async start(io) {
							const http = createServer((request, response) => {
								void (async () => {
									const address = http.address();
									if (!address || typeof address === "string") throw new Error("MCP listener is unavailable");
									const origin = request.headers.origin;
									if (
										![`127.0.0.1:${address.port}`, `localhost:${address.port}`].includes(request.headers.host ?? "") ||
										(origin && !(config.origins ?? []).includes(origin))
									) {
										response.writeHead(403).end("Host or Origin denied");
										return;
									}
									if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
									if (request.method === "OPTIONS") {
										response
											.writeHead(204, {
												"Access-Control-Allow-Methods": "POST, GET, DELETE",
												"Access-Control-Allow-Headers":
													"Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id",
											})
											.end();
										return;
									}
									const credential = await api.credentials.get(config.credential);
									const actual = Buffer.from(request.headers.authorization ?? "");
									const expected = Buffer.from(
										credential?.type === "api_key" && credential.key ? `Bearer ${credential.key}` : "",
									);
									if (!expected.length || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
										response.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("MCP authentication required");
										return;
									}
									if (response.destroyed) return;
									if (request.url !== "/mcp") {
										response.writeHead(404).end();
										return;
									}
									const mcp = createControlServer(api, io, id, config.account);
									clients.add(mcp);
									response.once("close", () => {
										clients.delete(mcp);
										void mcp.close().catch((error) => api.log.error("MCP close failed", { error: String(error) }));
									});
									const transport = new StreamableHTTPServerTransport({});
									// SDK 1.32.1's optional onclose declaration differs under exactOptionalPropertyTypes.
									await mcp.connect(transport as Transport);
									await transport.handleRequest(request, response);
								})().catch((error) => {
									api.log.error("MCP request failed", {
										error: error instanceof Error ? error.message : String(error),
									});
									if (!response.headersSent) response.writeHead(500).end("MCP request failed");
									else response.destroy();
								});
							});
							try {
								http.listen(config.port, "127.0.0.1");
								await once(http, "listening");
								server = http;
								api.log.info("MCP listening", { channel: id, address: http.address() });
								const credential = await api.credentials.get(config.credential);
								if (credential?.type !== "api_key" || !credential.key)
									api.log.warn("MCP credential is unavailable; requests are denied", { credential: config.credential });
							} catch (error) {
								api.log.error("MCP channel unavailable", { channel: id, error: String(error) });
							}
						},
						async stop() {
							await Promise.all([...clients].map((client) => client.close()));
							clients.clear();
							if (server) {
								server.closeAllConnections();
								await new Promise<void>((resolve, reject) =>
									server?.close((error) => (error ? reject(error) : resolve())),
								);
								server = undefined;
							}
						},
						async send() {
							return { ok: false, error: "MCP 控制端请通过 ask 或原生事件查询取回结果。" };
						},
					};
				},
			}),
		);
	},
});
