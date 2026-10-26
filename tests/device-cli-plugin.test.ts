import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Grant, PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../plugins/devices/src/index.js";

const cli = new URL("../packages/executor/dist/cli.js", import.meta.url).pathname;
const run = (args: string[], input?: unknown): Record<string, unknown> =>
	JSON.parse(
		execFileSync(process.execPath, [cli, ...args], {
			encoding: "utf8",
			...(input === undefined ? {} : { input: JSON.stringify(input) }),
		}),
	);

async function startDaemon(
	home: string,
	provider: string,
	key: string,
	cert: string,
	cardConfig?: string,
): Promise<{
	child: ChildProcess;
	ready: { deviceId: string; url: string; tlsFingerprint: string };
	cardState: () => string;
}> {
	let cardState = "";
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
			"--tls-key",
			key,
			"--tls-cert",
			cert,
			...(cardConfig ? ["--card-config", cardConfig] : []),
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const ready = await new Promise<{ deviceId: string; url: string; tlsFingerprint: string }>((resolve, reject) => {
		let out = "";
		let err = "";
		child.stdout?.on("data", (chunk) => {
			out += String(chunk);
			if (out.includes("\n")) resolve(JSON.parse(out.trim()));
		});
		child.stderr?.on("data", (chunk) => {
			err += String(chunk);
			cardState += String(chunk);
		});
		child.once("error", reject);
		child.once("exit", () => reject(new Error(err || "executor exited before ready")));
	});
	return { child, ready, cardState: () => cardState };
}

function testCertificate(key: string, cert: string): void {
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			key,
			"-out",
			cert,
			"-subj",
			"/CN=127.0.0.1",
			"-days",
			"1",
			"-addext",
			"subjectAltName=IP:127.0.0.1",
		],
		{ stdio: "ignore" },
	);
}

async function testProvider(provider: string, deviceId: string, effect: string): Promise<void> {
	await writeFile(
		provider,
		`import { appendFileSync } from "node:fs";
export function createBackendProvider() { return {
  describe: async () => ({ schemaVersion: 1, deviceId: ${JSON.stringify(deviceId)}, role: "execution-only", os: {name:"test",version:"1"}, hostArch:"test", processArch:"test", runtimeVersion:process.version, targets:[{id:"local",name:"Local"}], capabilities:[{id:"test.append",version:"1",scope:"local",state:"available"}], resources:{observedAt:null}, apps:{observedAt:null,status:"unsupported",complete:false}, lastSeenAt:null, health:"ready", routes:[], checkpointRestore:"unsupported" }),
  apps: async targetId => ({deviceId:${JSON.stringify(deviceId)},targetId,observedAt:null,status:"unsupported",complete:false,items:[]}),
  snapshot: async session => ({deviceId:${JSON.stringify(deviceId)},deviceSessionId:session.deviceSessionId,targetId:session.targetId,observedAt:new Date().toISOString(),status:"unsupported"}),
  actions: {"test.append": {capabilities:["write","exec"],mutatesDevice:true,validate:a=>typeof a.value==="string",resources:()=>({readRoots:[],writeRoots:[${JSON.stringify(effect)}]}),execute:async a=>{appendFileSync(${JSON.stringify(effect)},a.value);return {written:true}}}}
}; }
`,
	);
}

test("standalone executor CLI and default devices plugin complete a paired direct command", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-device-product-"));
	const deviceHome = join(root, "device"),
		controllerHome = join(root, "controller");
	const key = join(root, "tls-key.pem"),
		cert = join(root, "tls-cert.pem");
	const effect = join(root, "effect.txt"),
		provider = join(root, "provider.mjs");
	let child: ChildProcess | undefined;
	let stopPlugin: (() => Promise<void>) | undefined;
	try {
		testCertificate(key, cert);
		const identity = run(["init", "--home", deviceHome]);
		const deviceId = String(identity.deviceId);
		await testProvider(provider, deviceId, effect);
		const offer = run(["pair", "start", "--home", deviceHome, "--tls-cert", cert]);
		const proof = run(["pair", "connect", "--phase", "prepare", "--home", controllerHome], {
			offer,
			code: offer.code,
			deviceFingerprint: offer.deviceFingerprint,
			tlsFingerprint: offer.tlsFingerprint,
		});
		const grant: Grant = {
			grantId: randomUUID(),
			deviceId,
			principalId: String(proof.controllerFingerprint),
			revision: 0,
			capabilities: ["read", "write", "exec", "network"],
			targetIds: ["local"],
			actions: ["test.append"],
			readRoots: [],
			writeRoots: [effect],
			issuedAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 300_000).toISOString(),
			revokedAt: null,
		};
		const confirmation = run(["pair", "approve", "--home", deviceHome], { proof, code: offer.code, grants: [grant] });
		const started = await startDaemon(deviceHome, provider, key, cert);
		child = started.child;
		expect(started.ready.deviceId).toBe(deviceId);
		expect(started.ready.tlsFingerprint).toBe(offer.tlsFingerprint);
		run(["pair", "connect", "--phase", "finish", "--home", controllerHome], {
			pairingId: offer.pairingId,
			confirmation,
			direct: { url: started.ready.url, tlsFingerprint: started.ready.tlsFingerprint },
		});
		const { api, registrations } = createRegistrationCollector();
		plugin.setup({
			...api,
			config: { pairingHome: controllerHome, devices: [{ deviceId, name: "test executor", grants: [grant] }] },
			paths: { data: join(root, "plugin") },
		} as PluginAPI);
		const trigger = registrations.triggers[0];
		if (!trigger) throw new Error("Devices connection lifecycle was not registered");
		stopPlugin = () => trigger.stop();
		const context: ToolContext = {
			agent: null,
			profile: "integration",
			session: "direct-e2e",
			capabilities: ["read", "write", "exec", "network", "message"],
			env: { id: "test:isolated", cwd: root } as ToolContext["env"],
			signal: AbortSignal.timeout(20_000),
		};
		const tool = async (name: string, args: object) => {
			const registered = registrations.tools.find((t) => t.name === `devices_${name}`);
			if (!registered) throw new Error(`Missing devices_${name} tool`);
			const result = await registered.execute(args, context);
			if (result.isError) throw new Error(result.text);
			return JSON.parse(result.text);
		};
		expect((await tool("list", {})).devices).toHaveLength(1);
		expect(await tool("describe", { deviceId })).toMatchObject({ deviceId, role: "execution-only" });
		const session = await tool("open", { deviceId, targetId: "local" });
		const commandId = randomUUID();
		const args = {
			deviceId,
			deviceSessionId: session.deviceSessionId,
			commandId,
			action: "test.append",
			arguments: { value: "once" },
		};
		await tool("execute", args);
		await expect.poll(async () => (await tool("status", { deviceId, commandId })).state).toBe("succeeded");
		await tool("execute", args);
		expect(await readFile(effect, "utf8")).toBe("once");
		expect(await tool("close", { deviceId, deviceSessionId: session.deviceSessionId })).toEqual({ closed: true });
	} finally {
		await stopPlugin?.();
		if (child && child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			await once(child, "exit");
		}
		await rm(root, { recursive: true, force: true });
	}
}, 60_000);

const cardRoot = process.env.YONDER_CARD_ROOT;
test.skipIf(!cardRoot)(
	"default devices plugin reaches the actual executor CLI through Card and recovers across routes",
	async () => {
		if (!cardRoot) throw new Error("YONDER_CARD_ROOT required");
		const root = await mkdtemp(join(tmpdir(), "yonder-device-card-product-"));
		const dispose: Array<() => Promise<unknown>> = [() => rm(root, { recursive: true, force: true })];
		try {
			const load = (path: string) => import(pathToFileURL(path).href);
			const { services } = await load(join(cardRoot, "server/test/services.ts"));
			const { human, device: cardDevice } = await load(join(cardRoot, "server/test/chat-helpers.ts"));
			const { createApp } = await load(join(cardRoot, "server/src/app.ts"));
			const { createHub } = await load(join(cardRoot, "server/src/hub.ts"));
			const { attachWebSockets } = await load(join(cardRoot, "server/src/realtime.ts"));
			const { serve } = await load(join(cardRoot, "server/node_modules/@hono/node-server/dist/index.mjs"));
			const svc = await services();
			dispose.push(() => svc.close());
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
				{ cwd: join(cardRoot, "server") },
			);
			const hub = await createHub(svc.redis);
			dispose.push(() => hub.close());
			const deps = { ...svc, hub, origin: "http://127.0.0.1" };
			const app = createApp(deps);
			const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
			attachWebSockets(server, deps);
			if (!server.listening) await once(server, "listening");
			dispose.push(() => new Promise<void>((done) => server.close(() => done())));
			const baseUrl = `http://127.0.0.1:${server.address().port}`;
			const owner = await human(svc.pool);
			const controllerCard = await cardDevice(svc.pool, owner.id);
			const executorCard = await cardDevice(svc.pool, owner.id);

			const deviceHome = join(root, "executor"),
				controllerHome = join(root, "controller");
			const key = join(root, "tls-key.pem"),
				cert = join(root, "tls-cert.pem");
			const effect = join(root, "effect.txt"),
				provider = join(root, "provider.mjs");
			testCertificate(key, cert);
			const deviceId = String(run(["init", "--home", deviceHome]).deviceId);
			await testProvider(provider, deviceId, effect);
			const offer = run(["pair", "start", "--home", deviceHome, "--tls-cert", cert]);
			const proof = run(["pair", "connect", "--phase", "prepare", "--home", controllerHome], {
				offer,
				code: offer.code,
				deviceFingerprint: offer.deviceFingerprint,
				tlsFingerprint: offer.tlsFingerprint,
			});
			const grant: Grant = {
				grantId: randomUUID(),
				deviceId,
				principalId: String(proof.controllerFingerprint),
				revision: 0,
				capabilities: ["read", "write", "exec", "network"],
				targetIds: ["local"],
				actions: ["test.append"],
				readRoots: [],
				writeRoots: [effect],
				issuedAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 300_000).toISOString(),
				revokedAt: null,
			};
			const confirmation = run(["pair", "approve", "--home", deviceHome], { proof, code: offer.code, grants: [grant] });
			run(["pair", "connect", "--phase", "finish", "--home", controllerHome], {
				pairingId: offer.pairingId,
				confirmation,
			});
			const tokenFile = join(root, "card-token"),
				cardConfig = join(root, "card.json");
			await writeFile(tokenFile, executorCard.token, { mode: 0o600 });
			await writeFile(
				cardConfig,
				JSON.stringify({
					baseUrl,
					peerDeviceId: controllerCard.id,
					tokenFile,
					allowInsecureLoopback: true,
				}),
				{ mode: 0o600 },
			);
			const started = await startDaemon(deviceHome, provider, key, cert, cardConfig);
			dispose.push(async () => {
				if (started.child.exitCode === null && started.child.signalCode === null) {
					started.child.kill("SIGTERM");
					await once(started.child, "exit");
				}
			});
			await expect
				.poll(() => started.cardState().includes('"card":"connected"'), { timeout: 8_000, interval: 100 })
				.toBe(true);
			const context: ToolContext = {
				agent: null,
				profile: "integration",
				session: "card-e2e",
				capabilities: ["read", "write", "exec", "network", "message"],
				env: { id: "test:isolated", cwd: root } as ToolContext["env"],
				signal: AbortSignal.timeout(25_000),
			};
			const bind = (name: string, direct?: { url: string; tlsFingerprint: string }) => {
				const { api, registrations } = createRegistrationCollector();
				plugin.setup({
					...api,
					config: {
						pairingHome: controllerHome,
						allowInsecureLoopback: true,
						devices: [
							{
								deviceId,
								name,
								grants: [grant],
								...(direct ? { direct } : {}),
								card: { baseUrl, credential: "temporary-card-token", peerDeviceId: executorCard.id },
							},
						],
					},
					credentials: { get: async () => ({ type: "api_key", key: controllerCard.token }) },
					paths: { data: join(root, "plugin") },
				} as PluginAPI);
				const trigger = registrations.triggers[0];
				if (!trigger) throw new Error("Devices connection lifecycle missing");
				const tool = async (toolName: string, args: object) => {
					const registered = registrations.tools.find((t) => t.name === `devices_${toolName}`);
					if (!registered) throw new Error(`Missing devices_${toolName}`);
					const result = await registered.execute(args, context);
					if (result.isError) throw new Error(result.text);
					return JSON.parse(result.text);
				};
				return { tool, close: () => trigger.stop() };
			};
			const relay = bind("Card only");
			dispose.push(relay.close);
			expect(await relay.tool("describe", { deviceId })).toMatchObject({ deviceId });
			const cardSession = await relay.tool("open", { deviceId, targetId: "local" });
			const cardId = randomUUID();
			await relay.tool("execute", {
				deviceId,
				deviceSessionId: cardSession.deviceSessionId,
				commandId: cardId,
				action: "test.append",
				arguments: { value: "card" },
			});
			await expect
				.poll(async () => (await relay.tool("status", { deviceId, commandId: cardId })).state)
				.toBe("succeeded");
			await relay.tool("close", { deviceId, deviceSessionId: cardSession.deviceSessionId });
			await relay.close();

			const direct = { url: started.ready.url, tlsFingerprint: started.ready.tlsFingerprint };
			const dual = bind("direct and Card", direct);
			dispose.push(dual.close);
			const directSession = await dual.tool("open", { deviceId, targetId: "local" });
			const directId = randomUUID();
			await dual.tool("execute", {
				deviceId,
				deviceSessionId: directSession.deviceSessionId,
				commandId: directId,
				action: "test.append",
				arguments: { value: "+direct" },
			});
			await expect
				.poll(async () => (await dual.tool("status", { deviceId, commandId: directId })).state)
				.toBe("succeeded");
			await dual.tool("close", { deviceId, deviceSessionId: directSession.deviceSessionId });
			await dual.close();

			const unreachable = new URL(direct.url);
			unreachable.port = "1";
			const fallback = bind("failed direct, Card query", {
				url: unreachable.href,
				tlsFingerprint: direct.tlsFingerprint,
			});
			dispose.push(fallback.close);
			expect(await fallback.tool("status", { deviceId, commandId: directId })).toMatchObject({ state: "succeeded" });
			expect(await readFile(effect, "utf8")).toBe("card+direct");
		} finally {
			for (const close of dispose.reverse()) await close();
		}
	},
	60_000,
);
