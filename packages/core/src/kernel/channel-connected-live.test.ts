import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real model greets a newly authorized Card owner through the actual kernel and loopback transport",
	async () => {
		const home = await mkdtemp("/tmp/yonder-channel-connected-live-");
		const frames: Array<{ type?: string; ref?: string; content?: { text?: string } }> = [];
		const server = createServer(async (request, response) => {
			let raw = "";
			for await (const chunk of request) raw += chunk;
			response.setHeader("content-type", "application/json");
			if (request.url === "/api/device/start")
				response.end(JSON.stringify({ code: "test-code", url: `${endpoint}/connect` }));
			else if (request.url?.startsWith("/api/device/poll"))
				response.end(JSON.stringify({ status: "confirmed", deviceToken: "test-token" }));
			else if (request.url === "/api/device/agents")
				response.end(
					JSON.stringify(
						(JSON.parse(raw) as Array<{ key: string }>).map(({ key }) => ({ key, id: `platform-${key}` })),
					),
				);
			else if (request.url === "/api/session") response.end(JSON.stringify({ actor: { id: "owner" } }));
			else if (request.url === "/api/device/dm") response.end(JSON.stringify({ convId: "owner-dm" }));
			else {
				response.statusCode = 404;
				response.end("{}");
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
		const ws = new WebSocketServer({ server, path: "/ws/device" });
		ws.on("connection", (socket) =>
			socket.on("message", (raw) => {
				const frame = JSON.parse(raw.toString()) as (typeof frames)[number];
				frames.push(frame);
				if (frame.type === "send")
					socket.send(JSON.stringify({ type: "sent", ref: frame.ref, message: { id: "outbound" } }));
			}),
		);
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home, "owner", { model: "openai/gpt-6-luna" });
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.channels.card.endpoint = endpoint;
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const path = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(path, "utf8"));
			agent.defaults.instructions = "On channel.connected, send a brief greeting in your final response.";
			agent.bindings = agent.bindings.filter((binding: { id: string }) => binding.id !== "onboarding");
			await writeFile(path, stringify(agent));
			kernel = await openKernel(home);
			await kernel.channels.login({ instance: "card", action: "start" }, new AbortController().signal);
			await kernel.channels.login({ instance: "card", action: "poll" }, new AbortController().signal);
			await expect
				.poll(() => frames.some((frame) => frame.type === "send" && !!frame.content?.text), { timeout: 90_000 })
				.toBe(true);
			const events = (await kernel.events.query({ type: "channel.connected" })).events;
			expect(events).toHaveLength(1);
			expect(events[0]?.from).toBe("plugin:channel-card");
			expect(events[0]?.routes?.find((route) => route.agent === "main")).toMatchObject({ wake: "run" });
			await expect
				.poll(
					async () =>
						(await kernel!.events.query({ type: "message.out" })).events.some(
							(event) => (event.data as { delivery?: { ok?: boolean } }).delivery?.ok,
						),
					{ timeout: 10_000 },
				)
				.toBe(true);
		} finally {
			await kernel?.close();
			for (const socket of ws.clients) socket.terminate();
			await new Promise<void>((done) => ws.close(() => done()));
			await new Promise<void>((done) => server.close(() => done()));
			await rm(home, { recursive: true, force: true });
		}
	},
	120_000,
);
