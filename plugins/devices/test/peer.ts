import { execFile } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { arch, platform, release } from "node:os";
import { promisify } from "node:util";
import {
	type CommandReceipt,
	commandDigest,
	type DeviceDescriptor,
	type DeviceSession,
	decodeCommand,
	type Grant,
	publicKeyId,
	type RpcRequest,
	type RpcResponse,
	signMessage,
	verifyMessage,
} from "@yonder/sdk";
import type { RegisteredDevice } from "../src/transport.js";

/** Protocol test peer only. This is not W1, a model, or product E2E evidence. */
export async function protocolPeer() {
	const controllerKey = generateKeyPairSync("ed25519").privateKey;
	const deviceKey = generateKeyPairSync("ed25519").privateKey;
	const deviceId = randomUUID();
	const principalId = publicKeyId(controllerKey);
	const grant: Grant = {
		grantId: randomUUID(),
		deviceId,
		principalId,
		revision: 1,
		capabilities: ["read", "write", "exec", "network", "message"],
		targetIds: ["process"],
		actions: ["test.process"],
		readRoots: [],
		writeRoots: [],
		issuedAt: new Date(Date.now() - 1000).toISOString(),
		expiresAt: new Date(Date.now() + 600_000).toISOString(),
		revokedAt: null,
	};
	const seen: Array<{ route: string; request: RpcRequest }> = [];
	const commands = new Map<string, CommandReceipt>();
	const sessions = new Map<string, DeviceSession>();
	const state = {
		dropSubmit: false,
		offline: false,
		offlineStatus: false,
		dispatches: 0,
		beforeSubmit: async (_encoded: string) => {},
		alterResponse: (r: RpcResponse): RpcResponse => r,
	};
	const server = createServer(async (request, response) => {
		try {
			if (state.offline) {
				request.socket.destroy();
				return;
			}
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			const packet = JSON.parse(Buffer.concat(chunks).toString());
			const isCard = request.url === "/card";
			if (
				isCard &&
				(packet.protocol !== "yonder.execution.relay" || packet.version !== 1 || packet.routeId !== deviceId)
			)
				throw new Error("Bad relay frame");
			const message = verifyMessage(isCard ? packet.envelope : packet, controllerKey, {
				kind: "request",
				principalId,
				deviceId,
				now: Date.now(),
			});
			if (message.kind !== "request") throw new Error("Not a request");
			seen.push({ route: request.url!, request: message });
			if (message.method === "commands.status" && state.offlineStatus) {
				request.socket.destroy();
				return;
			}
			let result: unknown;
			let error: { code: "COMMAND_NOT_FOUND" | "UNSUPPORTED_OPERATION"; message: string } | undefined;
			switch (message.method) {
				case "device.describe":
					result = {
						schemaVersion: 1,
						deviceId,
						role: "execution-only",
						os: { name: platform(), version: release() },
						hostArch: arch(),
						processArch: arch(),
						runtimeVersion: process.version,
						targets: [{ id: "process", name: "Isolated protocol test process" }],
						capabilities: [],
						resources: { observedAt: null, reason: "Protocol peer does not collect resources" },
						apps: { observedAt: null, status: "unsupported", complete: false },
						lastSeenAt: new Date().toISOString(),
						health: "degraded",
						routes: [],
						checkpointRestore: "unsupported",
					} satisfies DeviceDescriptor;
					break;
				case "device.apps.list":
					result = {
						deviceId,
						targetId: message.params.targetId,
						observedAt: null,
						status: "unsupported",
						complete: false,
						items: [],
						reason: "Protocol peer does not enumerate apps",
					};
					break;
				case "device.sessions.open": {
					const session: DeviceSession = {
						deviceSessionId: randomUUID(),
						deviceId,
						principalId,
						targetId: message.params.targetId,
						grantId: message.params.grantId,
						grantRevision: grant.revision,
						leaseEpoch: 1,
						capabilities: message.params.capabilities,
						origin: message.params.origin,
						expiresAt: new Date(Date.now() + 60_000).toISOString(),
					};
					sessions.set(session.deviceSessionId, session);
					result = session;
					break;
				}
				case "device.ui.snapshot":
					result = {
						deviceId,
						deviceSessionId: message.params.deviceSessionId,
						targetId: "process",
						observedAt: new Date().toISOString(),
						status: "unsupported",
						reason: "No UI provider in protocol peer",
					};
					break;
				case "device.sessions.close":
					result = { closed: true };
					break;
				case "commands.submit": {
					await state.beforeSubmit(message.params.commandBase64);
					const command = decodeCommand(message.params.commandBase64, { deviceId, principalId });
					let receipt = commands.get(command.commandId);
					if (!receipt) {
						if (command.action !== "test.process") {
							error = { code: "UNSUPPORTED_OPERATION", message: "Unknown test backend action" };
							break;
						}
						state.dispatches++;
						const child = await promisify(execFile)(
							process.execPath,
							["-e", "process.stdout.write('protocol-child-ok')"],
							{ env: { PATH: process.env.PATH } },
						);
						const now = new Date().toISOString();
						receipt = {
							deviceId,
							principalId,
							commandId: command.commandId,
							deviceSessionId: command.deviceSessionId,
							payloadSha256: commandDigest(message.params.commandBase64),
							state: "succeeded",
							acceptedAt: now,
							updatedAt: now,
							result: child.stdout,
						};
						commands.set(command.commandId, receipt);
					}
					result = receipt;
					if (state.dropSubmit) {
						request.socket.destroy();
						return;
					}
					break;
				}
				case "commands.status":
				case "commands.cancel":
					result = commands.get(message.params.commandId);
					if (!result) error = { code: "COMMAND_NOT_FOUND", message: "No command record" };
					break;
				default:
					error = { code: "UNSUPPORTED_OPERATION", message: "Management RPC not exposed" };
			}
			const now = Date.now();
			const header = {
				protocol: "yonder.execution" as const,
				version: 1 as const,
				kind: "response" as const,
				requestId: message.requestId,
				principalId,
				deviceId,
				issuedAt: now,
				expiresAt: now + 60_000,
			};
			const reply: RpcResponse = error ? { ...header, ok: false, error } : { ...header, ok: true, result };
			const envelope = signMessage(state.alterResponse(reply), deviceKey);
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify(
					isCard ? { protocol: "yonder.execution.relay", version: 1, routeId: deviceId, envelope } : envelope,
				),
			);
		} catch {
			response.statusCode = 400;
			response.end("Invalid protocol test request");
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No loopback address");
	const route = (kind: "direct" | "card") => ({
		kind,
		async exchange(envelope: unknown, signal: AbortSignal): Promise<unknown> {
			const reply = await fetch(`http://127.0.0.1:${address.port}/${kind}`, {
				method: "POST",
				signal,
				headers: { "content-type": "application/json" },
				body: JSON.stringify(
					kind === "card" ? { protocol: "yonder.execution.relay", version: 1, routeId: deviceId, envelope } : envelope,
				),
			});
			const packet = await reply.json();
			return kind === "card" ? packet.envelope : packet;
		},
	});
	const device: RegisteredDevice = {
		deviceId,
		name: "Isolated loopback protocol peer",
		controllerKey,
		deviceKey,
		grants: [grant],
		routes: [route("direct"), route("card")],
	};
	return {
		device,
		grant,
		state,
		commands,
		sessions,
		seen,
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
		},
	};
}
