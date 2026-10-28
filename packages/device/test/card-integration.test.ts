import { execFileSync, spawn } from "node:child_process";
import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	commandDigest,
	type DeviceDescriptor,
	type DeviceSession,
	encodeCommand,
	type Grant,
	type RpcRequest,
	type RpcResponse,
	type SignedEnvelope,
	signMessage,
	verifyMessage,
} from "@yonder/protocol";
import { afterEach, expect, test } from "vitest";
import { WebSocket } from "ws";
import { ControllerPairing, ExecutorStore } from "../src/store.js";

const cardRoot = process.env.YONDER_CARD_ROOT;
const disposals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0).reverse()) await dispose();
});
const load = (path: string) => import(pathToFileURL(path).href);

test.skipIf(!cardRoot)(
	"actual CLI binds W3 ticket/WS and direct to one ledger; revoked Card does not stop direct",
	async () => {
		if (!cardRoot) throw Error("YONDER_CARD_ROOT required");
		const root = await mkdtemp(join(tmpdir(), "w1-card-daemon-"));
		disposals.push(() => rm(root, { recursive: true, force: true }));
		const sources = ["server/src/execution-relay.ts", "server/src/realtime.ts"];
		const hashes = () =>
			Promise.all(
				sources.map(async (p) =>
					createHash("sha256")
						.update(await readFile(join(cardRoot, p)))
						.digest("hex"),
				),
			);
		const before = await hashes();
		const { services } = await load(join(cardRoot, "server/test/services.ts"));
		const { human, device } = await load(join(cardRoot, "server/test/chat-helpers.ts"));
		const { createApp } = await load(join(cardRoot, "server/src/app.ts"));
		const { createHub } = await load(join(cardRoot, "server/src/hub.ts"));
		const { attachWebSockets } = await load(join(cardRoot, "server/src/realtime.ts"));
		const { serve } = await load(join(cardRoot, "server/node_modules/@hono/node-server/dist/index.mjs"));
		const svc = await services();
		disposals.push(() => svc.close());
		execFileSync(
			process.execPath,
			[
				"--import",
				join(cardRoot, "server/node_modules/tsx/dist/loader.mjs"),
				"--input-type=module",
				"-e",
				"const {migrate}=await import(process.argv[1]);await migrate(process.argv[2]);",
				pathToFileURL(join(cardRoot, "server/src/migrate.ts")).href,
				svc.databaseUrl,
			],
			{ cwd: join(cardRoot, "server"), stdio: "pipe" },
		);
		const hub = await createHub(svc.redis);
		disposals.push(() => hub.close());
		const deps = { ...svc, hub, origin: "http://127.0.0.1" };
		const app = createApp(deps),
			server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
		attachWebSockets(server, deps);
		if (!server.listening) await once(server, "listening");
		disposals.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
		const baseUrl = `http://127.0.0.1:${server.address().port}`;
		const owner = await human(svc.pool),
			controllerCard = await device(svc.pool, owner.id),
			executorCard = await device(svc.pool, owner.id);
		const home = join(root, "executor"),
			controllerHome = join(root, "controller"),
			effect = join(root, "effect");
		const store = new ExecutorStore(home),
			pairing = new ControllerPairing(controllerHome);
		const offer = store.beginPairing(),
			proof = pairing.prove(offer, offer.code, offer.deviceFingerprint);
		const grant: Grant = {
			grantId: randomUUID(),
			deviceId: store.data.deviceId,
			principalId: proof.controllerFingerprint,
			revision: 0,
			capabilities: ["read", "write", "exec"],
			targetIds: ["local"],
			actions: ["file.append"],
			readRoots: [root],
			writeRoots: [root],
			issuedAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 300_000).toISOString(),
			revokedAt: null,
		};
		pairing.finish(offer, store.approvePairing(proof, offer.code, [grant]));
		const deviceKey = store.key;
		store.close();
		const descriptor: DeviceDescriptor = {
			schemaVersion: 1,
			deviceId: offer.deviceId,
			role: "execution-only",
			os: { name: process.platform, version: process.version },
			hostArch: process.arch,
			processArch: process.arch,
			runtimeVersion: process.version,
			targets: [{ id: "local", name: "Local test process" }],
			capabilities: [{ id: "file.append", version: "1", scope: "local", state: "available" }],
			resources: { observedAt: null },
			apps: { observedAt: null, status: "unsupported", complete: false },
			lastSeenAt: null,
			health: "ready",
			routes: [],
			checkpointRestore: "unsupported",
		};
		const provider = join(root, "provider.mjs");
		await writeFile(
			provider,
			`import { appendFileSync } from 'node:fs'; export function createBackendProvider() { return { describe: async () => (${JSON.stringify(descriptor)}), apps: async () => {throw Error('unsupported')}, snapshot: async () => {throw Error('unsupported')}, actions: { 'file.append': { capabilities: ['write'], mutatesDevice: true, validate: a => typeof a.value === 'string', resources: () => ({readRoots:[],writeRoots:[${JSON.stringify(effect)}]}), execute: async a => {appendFileSync(${JSON.stringify(effect)}, a.value); return {written:true};} } } }; }`,
		);
		const tokenFile = join(root, "card-token"),
			config = join(root, "card.json");
		await writeFile(tokenFile, executorCard.token, { mode: 0o600 });
		await writeFile(
			config,
			JSON.stringify({ baseUrl, peerDeviceId: controllerCard.id, tokenFile, allowInsecureLoopback: true }),
			{ mode: 0o600 },
		);
		const openController = async () => {
			const ticketResponse = await fetch(`${baseUrl}/api/execution/ticket`, {
				method: "POST",
				headers: { authorization: `Bearer ${controllerCard.token}`, "content-type": "application/json" },
				body: JSON.stringify({ targetDeviceId: executorCard.id }),
			});
			expect(ticketResponse.status).toBe(201);
			const ticket = ((await ticketResponse.json()) as { ticket: string }).ticket;
			const peer = new WebSocket(`${baseUrl.replace("http:", "ws:")}/ws/execution`, {
				headers: { authorization: `Bearer ${controllerCard.token}`, "x-execution-relay-ticket": ticket },
			});
			peer.on("error", () => {});
			await once(peer, "open");
			return peer;
		};
		let socket = await openController();
		disposals.push(async () => {
			socket.terminate();
		});
		const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
		const child = spawn(
			process.execPath,
			[
				cli,
				"serve",
				"--home",
				home,
				"--provider",
				provider,
				"--host",
				"127.0.0.1",
				"--port",
				"0",
				"--card-config",
				config,
			],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		disposals.push(async () => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGTERM");
				await once(child, "exit");
			}
		});
		let stderr = "";
		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});
		const directUrl = await new Promise<string>((resolve, reject) => {
			let output = "";
			child.stdout.on("data", (data) => {
				output += data.toString();
				if (output.includes("\n")) resolve(JSON.parse(output).url);
			});
			child.on("error", reject);
			child.on("exit", () => reject(new Error(stderr || "early CLI exit")));
		});
		await expect.poll(() => stderr.includes('"card":"connected"')).toBe(true);
		const controllerKey = createPrivateKey(pairing.privateKey);
		const packet = (method: RpcRequest["method"], params: RpcRequest["params"]) =>
			signMessage(
				{
					protocol: "yonder.execution",
					version: 1,
					kind: "request",
					requestId: randomUUID(),
					principalId: grant.principalId,
					deviceId: offer.deviceId,
					issuedAt: Date.now(),
					expiresAt: Date.now() + 60_000,
					method,
					params,
				} as RpcRequest,
				controllerKey,
			);
		const decode = (envelope: SignedEnvelope, sent: SignedEnvelope): RpcResponse =>
			verifyMessage(envelope, deviceKey, {
				kind: "response",
				principalId: grant.principalId,
				deviceId: offer.deviceId,
				requestId: JSON.parse(Buffer.from(sent.payloadBase64, "base64").toString()).requestId,
				now: Date.now(),
			}) as RpcResponse;
		const direct = async (sent: SignedEnvelope) =>
			decode(
				(await (await fetch(directUrl, { method: "POST", body: JSON.stringify(sent) })).json()) as SignedEnvelope,
				sent,
			);
		const relay = (sent: SignedEnvelope): Promise<RpcResponse> =>
			new Promise((resolve, reject) => {
				const routeId = randomUUID();
				const timeout = setTimeout(() => {
					socket.off("message", receive);
					reject(Error("relay response timeout"));
				}, 3000);
				const receive = (raw: WebSocket.RawData) => {
					const message = JSON.parse(raw.toString());
					if (message.frame?.routeId === routeId) {
						clearTimeout(timeout);
						socket.off("message", receive);
						try {
							resolve(decode(message.frame.envelope, sent));
						} catch (error) {
							reject(error);
						}
					}
				};
				socket.on("message", receive);
				socket.send(
					JSON.stringify({
						type: "relay",
						targetDeviceId: executorCard.id,
						frame: { protocol: "yonder.execution.relay", version: 1, routeId, envelope: sent },
					}),
				);
			});
		const opened = await direct(
			packet("device.sessions.open", {
				targetId: "local",
				grantId: grant.grantId,
				capabilities: ["read", "write", "exec"],
				origin: { agentId: null, profileId: "test", modelSessionId: "test" },
			}),
		);
		expect(opened.ok).toBe(true);
		if (!opened.ok) throw Error(opened.error.code);
		const session = opened.result as DeviceSession,
			commandId = randomUUID();
		const bytes = encodeCommand({
			deviceId: offer.deviceId,
			principalId: grant.principalId,
			commandId,
			deviceSessionId: session.deviceSessionId,
			leaseEpoch: session.leaseEpoch,
			action: "file.append",
			arguments: { value: "once" },
		});
		await direct(packet("commands.submit", { commandBase64: bytes })); // Intentionally discard submit ACK.
		const duplicate = await relay(packet("commands.submit", { commandBase64: bytes }));
		expect(duplicate.ok).toBe(true);
		const status = await relay(packet("commands.status", { commandId }));
		expect(status.ok && status.result).toMatchObject({ state: "succeeded", payloadSha256: commandDigest(bytes) });
		expect(await readFile(effect, "utf8")).toBe("once");
		// Card's token authorizes routing only; its revocation cannot revoke the direct paired grant.
		await svc.pool.query("DELETE FROM sessions WHERE token_hash=$1", [
			createHash("sha256").update(executorCard.token).digest("hex"),
		]);
		const closed = once(socket, "close");
		socket.send(
			JSON.stringify({
				type: "relay",
				targetDeviceId: executorCard.id,
				frame: {
					protocol: "yonder.execution.relay",
					version: 1,
					routeId: randomUUID(),
					envelope: packet("device.describe", {}),
				},
			}),
		);
		await closed;
		const stillDirect = await direct(packet("commands.status", { commandId }));
		expect(stillDirect.ok && stillDirect.result).toMatchObject({ state: "succeeded" });
		expect(await readFile(effect, "utf8")).toBe("once");
		await svc.pool.query("INSERT INTO sessions(token_hash,account_id,kind,device_id) VALUES($1,$2,'device',$3)", [
			createHash("sha256").update(executorCard.token).digest("hex"),
			owner.id,
			executorCard.id,
		]);
		socket = await openController();
		await expect
			.poll(() => stderr.split('"card":"connected"').length - 1, { timeout: 8000, interval: 100 })
			.toBeGreaterThanOrEqual(2);
		const reconnected = await relay(packet("commands.status", { commandId }));
		expect(reconnected.ok && reconnected.result).toMatchObject({ state: "succeeded" });
		expect(await readFile(effect, "utf8")).toBe("once");
		expect(await hashes()).toEqual(before);
	},
	60_000,
);
