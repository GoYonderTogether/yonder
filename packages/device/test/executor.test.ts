import { execFileSync, spawn } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type DeviceSession,
	encodeCommand,
	type Grant,
	publicKeyId,
	type RpcRequest,
	type RpcResponse,
	type SignedEnvelope,
	signMessage,
	verifyMessage,
} from "@yonder/protocol";
import { afterEach, expect, test } from "vitest";
import type { BackendProvider } from "../src/backend-provider.js";
import { DeviceExecutor } from "../src/executor.js";
import { ControllerPairing } from "../src/store.js";

const homes: string[] = [];
const executors: DeviceExecutor[] = [];
afterEach(async () => {
	for (const executor of executors.splice(0)) await executor.close();
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const home = () => {
	const path = mkdtempSync(join(tmpdir(), "yonder-w1-"));
	homes.push(path);
	return path;
};
const origin = { agentId: null, profileId: "test", modelSessionId: "test-session" };
function provider(deviceId: () => string, output: string): BackendProvider {
	return {
		describe: async () => ({
			schemaVersion: 1,
			deviceId: deviceId(),
			role: "execution-only",
			os: { name: "test", version: "1" },
			hostArch: process.arch,
			processArch: process.arch,
			runtimeVersion: process.version,
			targets: [{ id: "local", name: "Local" }],
			capabilities: [{ id: "file.write", version: "1", scope: "local", state: "available" }],
			resources: { observedAt: null },
			apps: { observedAt: null, status: "unsupported", complete: false },
			lastSeenAt: null,
			health: "ready",
			routes: [],
			checkpointRestore: "unsupported",
		}),
		apps: async (targetId) => ({
			deviceId: deviceId(),
			targetId,
			observedAt: new Date().toISOString(),
			status: "unsupported",
			complete: false,
			items: [],
		}),
		snapshot: async (session) => ({
			deviceId: deviceId(),
			deviceSessionId: session.deviceSessionId,
			targetId: session.targetId,
			observedAt: new Date().toISOString(),
			status: "unsupported",
		}),
		actions: {
			"file.write": {
				capabilities: ["write"],
				mutatesDevice: true,
				validate: (args) => typeof args.value === "string",
				resources: () => ({ readRoots: [], writeRoots: [output] }),
				execute: async (args, { signal }) => {
					await new Promise<void>((resolve) => {
						const timer = setTimeout(resolve, 30);
						signal.addEventListener(
							"abort",
							() => {
								clearTimeout(timer);
								resolve();
							},
							{ once: true },
						);
					});
					if (signal.aborted) return null;
					writeFileSync(output, String(args.value), { flag: "a" });
					return { written: true };
				},
			},
		},
	};
}
async function fixture() {
	const root = home();
	const output = join(root, "effect");
	let executor!: DeviceExecutor;
	executor = new DeviceExecutor(
		join(root, "device"),
		provider(() => executor.deviceId, output),
	);
	executors.push(executor);
	const offer = executor.store.beginPairing();
	const controller = new ControllerPairing(join(root, "controller"));
	const proof = controller.prove(offer, offer.code, offer.deviceFingerprint);
	const grant: Grant = {
		grantId: randomUUID(),
		deviceId: executor.deviceId,
		principalId: proof.controllerFingerprint,
		revision: 0,
		capabilities: ["read", "write", "exec"],
		targetIds: ["local"],
		actions: ["file.write"],
		readRoots: [],
		writeRoots: [root],
		issuedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 3600_000).toISOString(),
		revokedAt: null,
	};
	const confirmation = executor.store.approvePairing(proof, offer.code, [grant]);
	controller.finish(offer, confirmation);
	const key = createPrivateKey(controller.privateKey);
	const call = async (
		method: RpcRequest["method"],
		params: RpcRequest["params"],
		transport: "direct" | "relay" = "relay",
		requestId = randomUUID(),
	): Promise<RpcResponse> => {
		const request = {
			protocol: "yonder.execution",
			version: 1,
			kind: "request",
			requestId,
			principalId: proof.controllerFingerprint,
			deviceId: executor.deviceId,
			issuedAt: Date.now(),
			expiresAt: Date.now() + 60_000,
			method,
			params,
		} as RpcRequest;
		const envelope = signMessage(request, key);
		let response: SignedEnvelope;
		if (transport === "direct") {
			const port = await executor.listenLoopback();
			const network = await fetch(`http://127.0.0.1:${port}/execution/v1`, {
				method: "POST",
				body: JSON.stringify(envelope),
			});
			response = (await network.json()) as SignedEnvelope;
		} else response = await executor.handle(envelope);
		return verifyMessage(response, createPublicKey(executor.store.key), {
			kind: "response",
			requestId,
			principalId: proof.controllerFingerprint,
			deviceId: executor.deviceId,
			now: Date.now(),
		}) as RpcResponse;
	};
	return { root, output, executor, controller, proof, grant, call };
}
const result = <T = Record<string, unknown>>(response: RpcResponse): T => {
	expect(response.ok).toBe(true);
	if (!response.ok) throw Error(response.error.code);
	return response.result as T;
};
const code = (response: RpcResponse) => (response.ok ? "OK" : response.error.code);
const session = async (f: Awaited<ReturnType<typeof fixture>>) =>
	result<DeviceSession>(
		await f.call("device.sessions.open", {
			targetId: "local",
			grantId: f.grant.grantId,
			capabilities: ["read", "write", "exec"],
			origin,
		}),
	);
const command = (f: Awaited<ReturnType<typeof fixture>>, s: DeviceSession, id = randomUUID(), value = "x") =>
	encodeCommand({
		deviceId: f.executor.deviceId,
		principalId: f.proof.controllerFingerprint,
		commandId: id,
		deviceSessionId: s.deviceSessionId,
		leaseEpoch: s.leaseEpoch,
		action: "file.write",
		arguments: { value },
	});

test("offline two-ended pairing, signed direct/relay RPC and one durable command", async () => {
	const f = await fixture();
	const s = await session(f);
	const id = randomUUID();
	const bytes = command(f, s, id);
	result(await f.call("commands.submit", { commandBase64: bytes }, "direct"));
	const duplicate = result(await f.call("commands.submit", { commandBase64: bytes }));
	expect(duplicate.commandId).toBe(id);
	await new Promise((resolve) => setTimeout(resolve, 60));
	expect(readFileSync(f.output, "utf8")).toBe("x");
	expect(result(await f.call("commands.status", { commandId: id })).state).toBe("succeeded");
	expect(code(await f.call("commands.submit", { commandBase64: command(f, s, id, "other") }))).toBe("COMMAND_CONFLICT");
	const next = await session(f);
	expect(code(await f.call("commands.submit", { commandBase64: bytes }))).toBe("LEASE_STALE");
	expect(result(await f.call("commands.status", { commandId: id })).state).toBe("succeeded");
	expect(next.deviceSessionId).not.toBe(s.deviceSessionId);
});

test("provider unsupported action keeps its protocol error code", async () => {
	const f = await fixture();
	const action = f.executor.backend.actions["file.write"];
	if (!action) throw new Error("Missing fixture action");
	action.execute = async () => {
		throw new Error("UNSUPPORTED_OPERATION");
	};
	const s = await session(f);
	const commandId = randomUUID();
	result(await f.call("commands.submit", { commandBase64: command(f, s, commandId) }));
	await new Promise((resolve) => setTimeout(resolve, 20));
	const receipt = result<{ state: string; error?: { code: string } }>(await f.call("commands.status", { commandId }));
	expect(receipt.state).toBe("failed");
	expect(receipt.error?.code).toBe("UNSUPPORTED_OPERATION");
});

test("revocation, cancellation, target and principal checks", async () => {
	const f = await fixture();
	const s = await session(f);
	f.grant.writeRoots = [];
	expect(code(await f.call("commands.submit", { commandBase64: command(f, s) }))).toBe("UNAUTHORIZED");
	f.grant.writeRoots = [f.root];
	const id = randomUUID();
	result(await f.call("commands.submit", { commandBase64: command(f, s, id) }));
	expect(result(await f.call("commands.cancel", { commandId: id })).state).toBe("cancelled");
	expect(() => readFileSync(f.output)).toThrow();
	const wrong = encodeCommand({
		deviceId: randomUUID(),
		principalId: f.proof.controllerFingerprint,
		commandId: randomUUID(),
		deviceSessionId: s.deviceSessionId,
		leaseEpoch: s.leaseEpoch,
		action: "file.write",
		arguments: { value: "bad" },
	});
	expect(code(await f.call("commands.submit", { commandBase64: wrong }))).toBe("WRONG_TARGET");
	result(await f.call("grants.revoke", { grantId: f.grant.grantId }));
	expect(code(await f.call("commands.status", { commandId: id }))).toBe("GRANT_REVOKED");
	expect(code(await f.call("commands.submit", { commandBase64: command(f, s) }))).toBe("GRANT_REVOKED");
});

test("same-home second daemon denied and crash recovery leaves running unknown", async () => {
	const f = await fixture();
	expect(
		() =>
			new DeviceExecutor(
				f.executor.store.home,
				provider(() => f.executor.deviceId, f.output),
			),
	).toThrow("BUSY");
	const child = execFileSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import { ExecutorStore } from ${JSON.stringify(new URL("../dist/store.js", import.meta.url).href)}; try { new ExecutorStore(process.argv[1]); process.stdout.write("WRONG"); } catch (error) { process.stdout.write(error.message); }`,
			f.executor.store.home,
		],
		{ encoding: "utf8" },
	);
	expect(child).toBe("BUSY");
	const id = randomUUID();
	const s = await session(f);
	const bytes = command(f, s, id);
	const record = {
		receipt: {
			deviceId: f.executor.deviceId,
			principalId: f.proof.controllerFingerprint,
			commandId: id,
			deviceSessionId: s.deviceSessionId,
			payloadSha256: createHash("sha256").update(Buffer.from(bytes, "base64")).digest("hex"),
			state: "running",
			acceptedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
		commandBase64: bytes,
		targetId: "local",
		action: "file.write",
		readRoots: [],
		writeRoots: [],
	};
	await f.executor.close();
	executors.splice(executors.indexOf(f.executor), 1);
	const crashChild = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import { ExecutorStore } from ${JSON.stringify(new URL("../dist/store.js", import.meta.url).href)}; const store = new ExecutorStore(process.argv[1]); store.data.commands[process.argv[2]] = JSON.parse(process.argv[3]); store.save(); process.stdout.write("READY\\n"); setInterval(() => {}, 1000);`,
			f.executor.store.home,
			JSON.stringify([f.executor.deviceId, f.proof.controllerFingerprint, id]),
			JSON.stringify(record),
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	await new Promise<void>((resolve, reject) => {
		crashChild.stdout.on("data", (data: Buffer) => {
			if (data.toString().includes("READY")) resolve();
		});
		crashChild.on("error", reject);
		crashChild.on("exit", () => reject(new Error("child exited before ready")));
	});
	crashChild.kill("SIGKILL");
	await once(crashChild, "exit");
	let recovered!: DeviceExecutor;
	recovered = new DeviceExecutor(
		f.executor.store.home,
		provider(() => recovered.deviceId, f.output),
	);
	executors.push(recovered);
	expect(
		recovered.store.data.commands[JSON.stringify([recovered.deviceId, f.proof.controllerFingerprint, id])]?.receipt
			.state,
	).toBe("unknown");
	expect(() => readFileSync(f.output)).toThrow();
});

test("unpaired and forged signatures, stale request, and request-id reuse are rejected", async () => {
	const f = await fixture();
	const stranger = generateKeyPairSync("ed25519");
	const request = {
		protocol: "yonder.execution",
		version: 1,
		kind: "request",
		requestId: randomUUID(),
		principalId: publicKeyId(stranger.publicKey),
		deviceId: f.executor.deviceId,
		issuedAt: Date.now(),
		expiresAt: Date.now() + 60_000,
		method: "device.describe",
		params: {},
	} as RpcRequest;
	await expect(f.executor.handle(signMessage(request, stranger.privateKey))).rejects.toThrow("UNPAIRED");
	const forged = { ...request, principalId: f.proof.controllerFingerprint } as RpcRequest;
	await expect(f.executor.handle(signMessage(forged, stranger.privateKey))).rejects.toThrow("UNAUTHORIZED");
	const pairedKey = createPrivateKey(f.controller.privateKey);
	const expired = { ...forged, issuedAt: Date.now() - 120_000, expiresAt: Date.now() - 60_000 } as RpcRequest;
	await expect(f.executor.handle(signMessage(expired, pairedKey))).rejects.toThrow("UNAUTHORIZED");
	const requestId = randomUUID();
	result(
		await f.call(
			"device.sessions.open",
			{ targetId: "local", grantId: f.grant.grantId, capabilities: ["read"], origin },
			"relay",
			requestId,
		),
	);
	await expect(
		f.call(
			"device.sessions.open",
			{ targetId: "local", grantId: f.grant.grantId, capabilities: ["read", "write"], origin },
			"relay",
			requestId,
		),
	).rejects.toThrow("COMMAND_CONFLICT");
});
