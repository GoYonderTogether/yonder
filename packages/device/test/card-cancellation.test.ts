import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { publicKeyId, signMessage } from "@yonder/protocol";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { CardDaemonConnection } from "../src/card-connection.js";

test("each Card socket owns its pre-acceptance signal and closing aborts pending verification", async () => {
	const home = await tempHome("device-card-cancel-");
	const tokenFile = join(home, "token");
	await writeFile(tokenFile, "isolated-test-token");
	const server = createServer((_req, res) =>
		res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ ticket: "a".repeat(43) })),
	);
	const sockets = new WebSocketServer({ server });
	const peerDeviceId = randomUUID();
	const keys = generateKeyPairSync("ed25519");
	const signals: AbortSignal[] = [];
	let connection: CardDaemonConnection | undefined;
	try {
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		sockets.on("connection", (socket) => {
			const issuedAt = Date.now();
			socket.send(
				JSON.stringify({
					type: "relay",
					sourceDeviceId: peerDeviceId,
					frame: {
						protocol: "yonder.execution.relay",
						version: 1,
						routeId: randomUUID(),
						envelope: signMessage(
							{
								protocol: "yonder.execution",
								version: 1,
								kind: "request",
								requestId: randomUUID(),
								deviceId: randomUUID(),
								principalId: publicKeyId(keys.publicKey),
								issuedAt,
								expiresAt: issuedAt + 60_000,
								method: "device.describe",
								params: {},
							},
							keys.privateKey,
						),
					},
				}),
			);
		});
		connection = new CardDaemonConnection(
			{
				baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
				peerDeviceId,
				tokenFile,
				allowInsecureLoopback: true,
			},
			async (_envelope, signal) => {
				signals.push(signal);
				return new Promise((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(new Error("verification cancelled")), { once: true }),
				);
			},
		);
		connection.start();
		await expect.poll(() => signals.length).toBe(1);
		expect(signals[0]?.aborted).toBe(false);
		for (const socket of sockets.clients) socket.terminate();
		await expect.poll(() => signals[0]?.aborted).toBe(true);
		await expect.poll(() => signals.length, { timeout: 5_000 }).toBe(2);
		expect(signals[1]).not.toBe(signals[0]);
		expect(signals[1]?.aborted).toBe(false);
		connection.close();
		await expect.poll(() => signals[1]?.aborted).toBe(true);
	} finally {
		connection?.close();
		for (const socket of sockets.clients) socket.terminate();
		await new Promise<void>((resolve) => sockets.close(() => resolve()));
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(home, { recursive: true, force: true });
	}
});
