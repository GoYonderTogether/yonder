import { execFile, execFileSync } from "node:child_process";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Grant, PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import { configuredRegistry } from "../src/connections.js";
import { executeCapabilities } from "../src/controller.js";
import plugin, { DeviceController } from "../src/index.js";
import { directRoute } from "../src/routes.js";

const w1 = process.env.YONDER_W1_ROOT,
	card = process.env.YONDER_CARD_ROOT;
const disposals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const dispose of disposals.splice(0).reverse()) await dispose();
});
const ctx = (session = "real-component-test"): ToolContext => ({
	agent: null,
	profile: "integration",
	session,
	capabilities: [...executeCapabilities],
	env: { id: "test:isolated", cwd: "/isolated" } as ToolContext["env"],
	signal: AbortSignal.timeout(15_000),
});

it.skipIf(!w1 || !card)(
	"default configured plugin talks to real W1 TLS and real W3 ticket/WS/PG/Redis without duplicate dispatch",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "yonder-w2-real-"));
		disposals.push(() => rm(root, { recursive: true, force: true }));
		const load = (path: string) => import(pathToFileURL(path).href);
		const sourceFiles = [
			join(w1!, "packages/device/src/executor.ts"),
			join(w1!, "packages/device/src/store.ts"),
			join(card!, "server/src/execution-relay.ts"),
			join(card!, "server/src/realtime.ts"),
		];
		const hashes = () =>
			Promise.all(
				sourceFiles.map(async (path) =>
					createHash("sha256")
						.update(await readFile(path))
						.digest("hex"),
				),
			);
		const sourceHashes = await hashes();
		const { DeviceExecutor } = await load(join(w1!, "packages/device/src/executor.ts"));
		const { ControllerPairing } = await load(join(w1!, "packages/device/src/store.ts"));
		const { services } = await load(join(card!, "server/test/services.ts"));
		const { human, device: cardDevice } = await load(join(card!, "server/test/chat-helpers.ts"));
		const { createApp } = await load(join(card!, "server/src/app.ts"));
		const { createHub } = await load(join(card!, "server/src/hub.ts"));
		const { attachWebSockets } = await load(join(card!, "server/src/realtime.ts"));
		const { serve } = await load(join(card!, "server/node_modules/@hono/node-server/dist/index.mjs"));
		const effect = join(root, "effect");
		let executor: InstanceType<typeof DeviceExecutor>;
		let dispatches = 0;
		executor = new DeviceExecutor(join(root, "executor"), {
			describe: async () => ({
				schemaVersion: 1,
				deviceId: executor.deviceId,
				role: "execution-only",
				os: { name: platform(), version: release() },
				hostArch: arch(),
				processArch: arch(),
				runtimeVersion: process.version,
				targets: [{ id: "isolated-process", name: "Isolated local Node process" }],
				capabilities: [{ id: "process.append", version: "1", scope: "isolated-process", state: "available" }],
				resources: { observedAt: null },
				apps: { observedAt: null, status: "unsupported", complete: false },
				lastSeenAt: null,
				health: "ready",
				routes: [],
				checkpointRestore: "unsupported",
			}),
			apps: async (targetId: string) => ({
				deviceId: executor.deviceId,
				targetId,
				observedAt: null,
				status: "unsupported",
				complete: false,
				items: [],
			}),
			snapshot: async (session: { deviceSessionId: string; targetId: string }) => ({
				deviceId: executor.deviceId,
				deviceSessionId: session.deviceSessionId,
				targetId: session.targetId,
				observedAt: new Date().toISOString(),
				status: "unsupported",
			}),
			actions: {
				"process.append": {
					capabilities: ["write", "exec"],
					mutatesDevice: true,
					validate: (a: Record<string, unknown>) => typeof a.value === "string",
					resources: () => ({ readRoots: [], writeRoots: [effect] }),
					async execute(a: Record<string, unknown>) {
						dispatches++;
						await promisify(execFile)(
							process.execPath,
							["-e", "require('node:fs').appendFileSync(process.argv[1], process.argv[2])", effect, String(a.value)],
							{ env: { PATH: process.env.PATH } },
						);
						return { written: true };
					},
				},
			},
		});
		disposals.push(() => executor.close());
		const cert = join(root, "cert.pem"),
			key = join(root, "key.pem");
		const opensslConfig = join(root, "openssl.cnf");
		await writeFile(
			opensslConfig,
			"[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=127.0.0.1\n[ext]\nsubjectAltName=IP:127.0.0.1\n",
		);
		execFileSync(
			"/usr/bin/openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-days",
				"1",
				"-keyout",
				key,
				"-out",
				cert,
				"-config",
				opensslConfig,
			],
			{ stdio: "ignore" },
		);
		const certBytes = await readFile(cert),
			pin = createHash("sha256").update(new X509Certificate(certBytes).raw).digest("hex");
		const port = await executor.listenDirect({
			host: "127.0.0.1",
			port: 0,
			tls: { key: await readFile(key), cert: certBytes },
		});
		const directUrl = `https://127.0.0.1:${port}/execution/v1`;
		const pairingHome = join(root, "controller");
		const pairing = new ControllerPairing(pairingHome),
			offer = executor.store.beginPairing(300_000, pin);
		const proof = pairing.prove(offer, offer.code, offer.deviceFingerprint, pin);
		const grant: Grant = {
			grantId: randomUUID(),
			deviceId: executor.deviceId,
			principalId: proof.controllerFingerprint,
			revision: 0,
			capabilities: [...executeCapabilities],
			targetIds: ["isolated-process"],
			actions: ["process.append"],
			readRoots: [root],
			writeRoots: [root],
			issuedAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 300_000).toISOString(),
			revokedAt: null,
		};
		pairing.finish(offer, executor.store.approvePairing(proof, offer.code, [grant]), {
			url: directUrl,
			tlsFingerprint: pin,
		});
		const discovery = configuredRegistry(
			{ pairingHome },
			{
				get: async () => {
					throw new Error("Discovery must not access Card credentials");
				},
			},
		);
		expect(await discovery.registry()).toMatchObject([{ deviceId: executor.deviceId, grants: [] }]);
		const svc = await services();
		disposals.push(() => svc.close());
		await promisify(execFile)(
			process.execPath,
			[
				"--import",
				join(card!, "server/node_modules/tsx/dist/loader.mjs"),
				"--input-type=module",
				"-e",
				"const {migrate}=await import(process.argv[1]);await migrate(process.argv[2]);",
				pathToFileURL(join(card!, "server/src/migrate.ts")).href,
				svc.databaseUrl,
			],
			{ cwd: join(card!, "server") },
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
			controllerCard = await cardDevice(svc.pool, owner.id),
			executorCard = await cardDevice(svc.pool, owner.id);
		const ticketResponse = await fetch(`${baseUrl}/api/execution/ticket`, {
			method: "POST",
			headers: { authorization: `Bearer ${executorCard.token}`, "content-type": "application/json" },
			body: JSON.stringify({ targetDeviceId: controllerCard.id }),
		});
		expect(ticketResponse.status).toBe(201);
		const ticket = (await ticketResponse.json()).ticket;
		const bridge = new WebSocket(baseUrl.replace("http:", "ws:") + "/ws/execution", {
			headers: { authorization: `Bearer ${executorCard.token}`, "x-execution-relay-ticket": ticket },
		});
		bridge.on("error", () => {});
		await once(bridge, "open");
		disposals.push(async () => {
			bridge.terminate();
		});
		bridge.on("message", async (bytes) => {
			const message = JSON.parse(bytes.toString());
			if (message.type !== "relay" || message.sourceDeviceId !== controllerCard.id) return;
			const answer = await executor.handle(message.frame.envelope);
			bridge.send(
				JSON.stringify({
					type: "relay",
					targetDeviceId: controllerCard.id,
					frame: { ...message.frame, envelope: answer },
				}),
			);
		});
		const config = {
			pairingHome,
			allowInsecureLoopback: true,
			devices: [
				{
					deviceId: executor.deviceId,
					name: "W1 isolated executor",
					grants: [grant],
					direct: { url: directUrl, tlsFingerprint: pin },
					card: { baseUrl, credential: "temporary-test-card-device", peerDeviceId: executorCard.id },
				},
			],
		};
		const credentials = {
			get: async (name: string) => {
				expect(name).toBe("temporary-test-card-device");
				return { type: "api_key" as const, key: controllerCard.token };
			},
		};
		const { api, registrations } = createRegistrationCollector();
		plugin.setup({ ...api, config, credentials, paths: { data: join(root, "plugin") } } as PluginAPI);
		disposals.push(() => registrations.triggers[0]!.stop());
		const tool = async (name: string, args: object) => {
			const result = await registrations.tools.find((t) => t.name === `devices_${name}`)!.execute(args, ctx());
			if (result.isError) throw new Error(result.text);
			return JSON.parse(result.text);
		};
		expect((await tool("list", {})).devices).toHaveLength(1);
		expect(await tool("describe", { deviceId: executor.deviceId })).toMatchObject({
			os: { name: platform() },
			runtimeVersion: process.version,
		});
		expect(await tool("apps", { deviceId: executor.deviceId, targetId: "isolated-process" })).toMatchObject({
			status: "unsupported",
		});
		const session = await tool("open", { deviceId: executor.deviceId, targetId: "isolated-process" });
		expect(
			await tool("observe", { deviceId: executor.deviceId, deviceSessionId: session.deviceSessionId }),
		).toMatchObject({ status: "unsupported" });
		const commandId = randomUUID();
		await tool("execute", {
			deviceId: executor.deviceId,
			deviceSessionId: session.deviceSessionId,
			commandId,
			action: "process.append",
			arguments: { value: "direct-once" },
		});
		await expect
			.poll(async () => (await tool("status", { deviceId: executor.deviceId, commandId })).state)
			.toBe("succeeded");
		expect(await readFile(effect, "utf8")).toBe("direct-once");
		expect(await tool("close", { deviceId: executor.deviceId, deviceSessionId: session.deviceSessionId })).toEqual({
			closed: true,
		});
		const connected = configuredRegistry(config, credentials);
		disposals.push(connected.close);
		const registry = async () =>
			(await connected.registry()).map((d) => ({
				...d,
				routes: d.routes.map((route) =>
					route.kind === "direct"
						? {
								...route,
								async exchange(envelope, signal) {
									const result = await route.exchange(envelope, signal);
									const method = JSON.parse(Buffer.from(envelope.payloadBase64, "base64").toString()).method;
									if (method === "commands.submit") throw new Error("Intentionally dropped submit ACK");
									if (method === "commands.status") throw new Error("Direct unavailable for recovery queries");
									return result;
								},
							}
						: route,
				),
			}));
		const recovering = new DeviceController(join(root, "recovery-plugin"), registry);
		const s = await recovering.open(executor.deviceId, "isolated-process", ctx());
		const lost = randomUUID();
		await recovering.execute(
			executor.deviceId,
			s.deviceSessionId,
			lost,
			"process.append",
			{ value: "+relay-recovery-once" },
			ctx(),
		);
		await expect
			.poll(async () => (await recovering.status(executor.deviceId, lost, ctx("new-model-session"))).state)
			.toBe("succeeded");
		await recovering.execute(
			executor.deviceId,
			s.deviceSessionId,
			lost,
			"process.append",
			{ value: "+relay-recovery-once" },
			ctx(),
		);
		expect(await readFile(effect, "utf8")).toBe("direct-once+relay-recovery-once");
		expect(dispatches).toBe(2);
		expect(await recovering.close(executor.deviceId, s.deviceSessionId, ctx())).toEqual({ closed: true });
		const trusted = (await connected.registry())[0]!;
		await expect(
			directRoute({ url: directUrl, tlsFingerprint: "0".repeat(64) }).exchange(
				{
					algorithm: "Ed25519",
					keyId: proof.controllerFingerprint,
					payloadBase64: "e30=",
					signatureBase64: "x".repeat(88),
				},
				AbortSignal.timeout(3000),
			),
		).rejects.toThrow("fingerprint");
		expect(trusted.controllerKey.type).toBe("private");
		expect(await hashes()).toEqual(sourceHashes);
		process.stdout.write(
			`W2 real component sources: ${JSON.stringify({ w1: execFileSync("git", ["rev-parse", "HEAD"], { cwd: w1, encoding: "utf8" }).trim(), card: execFileSync("git", ["rev-parse", "HEAD"], { cwd: card, encoding: "utf8" }).trim(), files: sourceFiles.map((path, index) => ({ path, sha256: sourceHashes[index] })) })}\n`,
		);
	},
	60_000,
);
