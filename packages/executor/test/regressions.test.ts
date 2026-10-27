import { type ChildProcess, spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	type DeviceDescriptor,
	type DeviceSession,
	type Grant,
	publicKeyId,
	type RpcRequest,
	type RpcResponse,
	signMessage,
	verifyMessage,
} from "@yonder/execution-protocol";
import { afterEach, expect, test } from "vitest";
import type { BackendProvider } from "../src/backend-provider.js";
import { DeviceExecutor } from "../src/executor.js";
import { ExecutorStore } from "../src/store.js";

const roots: string[] = [];
const children: ChildProcess[] = [];
const executors = new Set<DeviceExecutor>();
afterEach(async () => {
	for (const child of children.splice(0))
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGKILL");
			await once(child, "exit");
		}
	for (const executor of executors) await executor.close();
	executors.clear();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const root = () => {
	const path = mkdtempSync(join(tmpdir(), "w1-regression-"));
	roots.push(path);
	return path;
};
const storeUrl = new URL("../dist/store.js", import.meta.url).href;
const executorUrl = new URL("../dist/executor.js", import.meta.url).href;

async function contenders(home: string): Promise<ChildProcess> {
	const attempts = [0, 1].map(() => {
		const child = spawn(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { ExecutorStore } from ${JSON.stringify(storeUrl)}; console.log("READY"); await new Promise(r => process.stdin.once("data", r)); try { const store = new ExecutorStore(process.argv[1]); console.log("OWNED"); setInterval(() => {}, 1000); } catch (error) { console.log(error.message); }`,
				home,
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		children.push(child);
		return { child, lines: createInterface({ input: child.stdout })[Symbol.asyncIterator]() };
	});
	expect(await Promise.all(attempts.map(async (a) => (await a.lines.next()).value))).toEqual(["READY", "READY"]);
	for (const a of attempts) a.child.stdin.end("GO");
	const outcomes = await Promise.all(attempts.map(async (a) => (await a.lines.next()).value));
	expect([...outcomes].sort()).toEqual(["BUSY", "OWNED"]);
	const winner = attempts[outcomes.indexOf("OWNED")];
	if (!winner) throw new Error("missing owner");
	// A rejected contender must not release the winner's lock.
	expect(() => new ExecutorStore(home)).toThrow("BUSY");
	return winner.child;
}

test("simultaneous daemon contenders have one owner, including after owner death", async () => {
	const home = root();
	for (let round = 0; round < 3; round++) {
		const owner = await contenders(home);
		owner.kill("SIGKILL");
		await once(owner, "exit");
		expect(existsSync(join(home, "daemon-lock.sqlite"))).toBe(true);
	}
	const store = new ExecutorStore(home);
	store.close();
	const next = new ExecutorStore(home);
	store.close();
	expect(() => new ExecutorStore(home)).toThrow("BUSY");
	next.close();
});

test("legacy stale directory is refused without removing it", () => {
	const home = root();
	mkdirSync(join(home, "daemon.lock"));
	expect(() => new ExecutorStore(home)).toThrow("BUSY");
	expect(existsSync(join(home, "daemon.lock"))).toBe(true);
});

function fixture() {
	const home = root();
	let executor!: DeviceExecutor;
	const descriptor = (): DeviceDescriptor => ({
		schemaVersion: 1,
		deviceId: executor.deviceId,
		role: "execution-only",
		os: { name: process.platform, version: process.version },
		hostArch: process.arch,
		processArch: process.arch,
		runtimeVersion: process.version,
		targets: [
			{ id: "local", name: "Local" },
			{ id: "hidden", name: "Hidden" },
		],
		capabilities: [
			{ id: "read", scope: "local", version: "1", state: "available" },
			{ id: "read-secret", scope: "hidden", version: "1", state: "available" },
		],
		resources: { observedAt: null },
		apps: { observedAt: null, status: "unsupported", complete: false },
		health: "ready",
		lastSeenAt: null,
		routes: [],
		checkpointRestore: "unsupported",
	});
	const provider: BackendProvider = {
		describe: async () => descriptor(),
		apps: async () => {
			throw Error("unsupported");
		},
		snapshot: async () => {
			throw Error("unsupported");
		},
		actions: {},
	};
	executor = new DeviceExecutor(home, provider);
	executors.add(executor);
	const keys = generateKeyPairSync("ed25519");
	const principalId = publicKeyId(keys.publicKey);
	const grant: Grant = {
		grantId: randomUUID(),
		deviceId: executor.deviceId,
		principalId,
		revision: 0,
		capabilities: ["read"],
		targetIds: ["local"],
		actions: [],
		readRoots: [],
		writeRoots: [],
		issuedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 3600_000).toISOString(),
		revokedAt: null,
	};
	executor.store.data.peers[principalId] = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
	executor.store.data.grants[grant.grantId] = grant;
	executor.store.save();
	const envelope = (method: RpcRequest["method"], params: RpcRequest["params"]) =>
		signMessage(
			{
				protocol: "yonder.execution",
				version: 1,
				kind: "request",
				requestId: randomUUID(),
				principalId,
				deviceId: executor.deviceId,
				issuedAt: Date.now(),
				expiresAt: Date.now() + 60_000,
				method,
				params,
			} as RpcRequest,
			keys.privateKey,
		);
	const decode = (packet: Parameters<typeof verifyMessage>[0]): RpcResponse =>
		verifyMessage(packet, keysForDevice(), {
			kind: "response",
			requestId: JSON.parse(Buffer.from((packet as { payloadBase64: string }).payloadBase64, "base64").toString())
				.requestId,
			principalId,
			deviceId: executor.deviceId,
			now: Date.now(),
		}) as RpcResponse;
	const keysForDevice = () => executor.store.key;
	const open = () =>
		envelope("device.sessions.open", {
			targetId: "local",
			grantId: grant.grantId,
			capabilities: ["read"],
			origin: { agentId: null, profileId: "test", modelSessionId: "test" },
		});
	return { home, executor, provider, descriptor, grant, envelope, open, decode };
}

test("describe filters targets and scoped capabilities using current effective read grants", async () => {
	const f = fixture();
	const hidden = { ...f.grant, grantId: randomUUID(), targetIds: ["hidden"], revokedAt: new Date().toISOString() };
	f.executor.store.data.grants[hidden.grantId] = hidden;
	const response = f.decode(await f.executor.handle(f.envelope("device.describe", {})));
	expect(response.ok).toBe(true);
	if (!response.ok) return;
	const descriptor = response.result as DeviceDescriptor;
	expect(descriptor.targets.map((t) => t.id)).toEqual(["local"]);
	expect(descriptor.capabilities.map((c) => c.scope)).toEqual(["local"]);
});

test("concurrent copies of one sessions.open return the same lease", async () => {
	const f = fixture();
	const packet = f.open();
	const responses = await Promise.all([f.executor.handle(packet), f.executor.handle(packet)]);
	expect(f.decode(responses[0]).ok).toBe(true);
	expect(f.decode(responses[0])).toEqual(f.decode(responses[1]));
	expect(f.executor.store.data.leaseEpochs.local).toBe(1);
	expect(Object.keys(f.executor.store.data.sessions)).toHaveLength(1);
});

test("failed publication fences direct and relay retries until durable state is reloaded", async () => {
	const f = fixture();
	const packet = f.envelope("grants.revoke", { grantId: f.grant.grantId });
	const request = JSON.parse(Buffer.from(packet.payloadBase64, "base64").toString()) as RpcRequest;
	const requestKey = `${request.principalId}:${request.requestId}`;
	const durable = () =>
		JSON.parse(readFileSync(join(f.home, "state.json"), "utf8")) as {
			grants: Record<string, Grant>;
			requests: Record<string, unknown>;
		};
	const port = await f.executor.listenLoopback();
	f.executor.store.save = () => {
		throw new Error("injected save failure");
	};
	const direct = await fetch(`http://127.0.0.1:${port}/execution/v1`, {
		method: "POST",
		body: JSON.stringify(packet),
	});
	expect(direct.status).toBe(400);
	expect(f.executor.store.data.grants[f.grant.grantId]?.revokedAt).not.toBeNull();
	expect(durable().grants[f.grant.grantId]?.revokedAt).toBeNull();
	expect(durable().requests[requestKey]).toBeUndefined();
	// Card's transport calls this same handler. Neither it nor a fresh request may see the unsaved success.
	await expect(f.executor.handle(packet)).rejects.toThrow("INTERNAL_ERROR");
	await expect(f.executor.handle(f.open())).rejects.toThrow("INTERNAL_ERROR");
	await f.executor.close();
	executors.delete(f.executor);
	const recovered = new DeviceExecutor(f.home, f.provider);
	executors.add(recovered);
	expect(recovered.store.data.grants[f.grant.grantId]?.revokedAt).toBeNull();
	expect(recovered.store.data.requests[requestKey]).toBeUndefined();
	expect(f.decode(await recovered.handle(packet)).ok).toBe(true);
	expect(durable().grants[f.grant.grantId]?.revokedAt).not.toBeNull();
	expect(durable().requests[requestKey]).toBeDefined();
});

for (const method of ["device.sessions.open", "device.sessions.close", "grants.revoke"] as const) {
	for (const window of ["before", "after"] as const) {
		test(`${method} effect and receipt survive a crash ${window} publication together`, async () => {
			const f = fixture();
			const opened = f.decode(await f.executor.handle(f.open()));
			if (!opened.ok) throw Error("open failed");
			const session = opened.result as DeviceSession;
			const packet =
				method === "device.sessions.open"
					? f.open()
					: method === "device.sessions.close"
						? f.envelope(method, { deviceSessionId: session.deviceSessionId })
						: f.envelope(method, { grantId: f.grant.grantId });
			const beforeEpoch = f.executor.store.data.leaseEpochs.local;
			const request = JSON.parse(Buffer.from(packet.payloadBase64, "base64").toString()) as RpcRequest;
			const descriptor = f.descriptor();
			await f.executor.close();
			executors.delete(f.executor);
			const code = `import { DeviceExecutor } from ${JSON.stringify(executorUrl)}; const executor = new DeviceExecutor(process.argv[1], {describe:async()=>JSON.parse(process.argv[3]),actions:{}}); const save = executor.store.save.bind(executor.store); executor.store.save = () => { if(process.argv[4] === "before") process.kill(process.pid,"SIGKILL"); save(); process.kill(process.pid,"SIGKILL"); }; await executor.handle(JSON.parse(process.argv[2]));`;
			const child = spawn(
				process.execPath,
				["--input-type=module", "-e", code, f.home, JSON.stringify(packet), JSON.stringify(descriptor), window],
				{ stdio: "ignore" },
			);
			children.push(child);
			const [, signal] = await once(child, "exit");
			expect(signal).toBe("SIGKILL");
			const recovered = new DeviceExecutor(f.home, f.provider);
			executors.add(recovered);
			const key = `${request.principalId}:${request.requestId}`;
			expect(!!recovered.store.data.requests[key]).toBe(window === "after");
			const epochAfterEffect = method === "grants.revoke" ? beforeEpoch : (beforeEpoch ?? 0) + 1;
			expect(recovered.store.data.leaseEpochs.local).toBe(window === "after" ? epochAfterEffect : beforeEpoch);
			expect(recovered.store.data.grants[f.grant.grantId]?.revision).toBe(
				method === "grants.revoke" && window === "after" ? 1 : 0,
			);
			await recovered.handle(packet);
			expect(recovered.store.data.leaseEpochs.local).toBe(epochAfterEffect);
			expect(recovered.store.data.grants[f.grant.grantId]?.revision).toBe(method === "grants.revoke" ? 1 : 0);
			const receipt = structuredClone(recovered.store.data.requests[key]);
			await recovered.handle(packet);
			expect(recovered.store.data.requests[key]).toEqual(receipt);
		});
	}
}
