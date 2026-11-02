import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { resolveProfile } from "@yonder/bot-definition";
import type { Hook, Tool } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { Type } from "typebox";
import { expect, test } from "vitest";
import { openNodeRuntime } from "../node/open-runtime.js";
import { openDatabase, openRuntimeStorage } from "../node/runtime/db.js";
import { hostToolSignature } from "./host-tools.js";

type Request = { model?: string; tools?: Array<{ function?: { name?: string } }> };

test("host tools disappear from the next actual provider request after transport goes offline", async () => {
	const home = await tempHome("yonder-host-tools-request-");
	const requests: Request[] = [];
	let online = true;
	let executed = false;
	let requestHookCalls = 0;
	let runtime: Awaited<ReturnType<typeof openNodeRuntime>> | undefined;
	const tool: Tool = {
		name: "device_status",
		description: "Read the connected device status.",
		parameters: Type.Object({}),
		capabilities: [],
		async execute() {
			executed = true;
			online = false;
			return { text: "device status read" };
		},
	};
	const laterMessagesHook: Hook = {
		id: "request-copy-after-host-tools",
		beforeRequest(messages) {
			requestHookCalls++;
			return { messages: [...messages] };
		},
	};
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		requests.push(JSON.parse(body) as Request);
		const common = { id: "loopback", object: "chat.completion.chunk", created: 1, model: "glm-5.3-flash" };
		const chunks =
			requests.length === 1
				? [
						{
							...common,
							choices: [
								{
									index: 0,
									delta: {
										role: "assistant",
										tool_calls: [
											{
												index: 0,
												id: "call-device-status",
												type: "function",
												function: { name: tool.name, arguments: "{}" },
											},
										],
									},
									finish_reason: null,
								},
							],
						},
						{
							...common,
							choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
						},
					]
				: [
						{
							...common,
							choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }],
						},
						{
							...common,
							choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
						},
					];
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.end(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Loopback provider did not bind");
	const auth = join(home, "auth.json");
	await writeFile(auth, JSON.stringify({ zai: { type: "api_key", key: "host-tools-loopback-key" } }), { mode: 0o600 });
	try {
		runtime = await openNodeRuntime({
			home,
			storage: await openRuntimeStorage(await openDatabase(join(home, "state.db"))),
			config: {
				schema: 1,
				credentials: auth,
				compaction: { enabled: false },
				retry: { maxRetries: 0 },
				models: { providers: { zai: { baseUrl: `http://127.0.0.1:${address.port}/v1` } } },
			},
			localEnvironment: true,
			plugins: [{ id: "request-filter", tools: [], hooks: [laterMessagesHook] }],
			refreshHostTools: async () => (online ? [tool.name] : []),
			resolveSession: async () => {
				runtime?.setHostTools([tool]);
				return {
					agent: "owner",
					profile: "host-tools-request",
					cwd: home,
					hostTools: [{ name: tool.name, signature: hostToolSignature(tool), capabilities: tool.capabilities }],
					resolved: resolveProfile({
						model: "zai/glm-5.3-flash",
						plugins: ["request-filter"],
						capabilities: [],
						tools: { offer: [tool.name] },
					}),
				};
			},
		});
		const session = await runtime.create({ agent: "owner", profile: "host-tools-request", cwd: home });
		const result = await runtime.submit(session, { text: "Read the connected device status once, then reply done." });
		expect(result.status, result.reason).toBe("done");
		expect(executed).toBe(true);
		expect(online).toBe(false);
		expect(requestHookCalls).toBe(2);
		expect(requests).toHaveLength(2);
		expect(requests[0]?.model).toBe("glm-5.3-flash");
		expect(requests[0]?.tools?.some(({ function: descriptor }) => descriptor?.name === tool.name)).toBe(true);
		expect(requests[1]?.tools?.some(({ function: descriptor }) => descriptor?.name === tool.name)).toBe(false);
	} finally {
		await runtime?.close();
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		await rm(home, { recursive: true, force: true });
	}
});
