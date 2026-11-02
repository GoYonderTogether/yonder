import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import { fileURLToPath } from "node:url";
import {
	type Grant,
	MAX_MESSAGE_AGE_MS,
	publicKeyId,
	type RpcRequest,
	type RpcResponse,
	type SignedEnvelope,
	signMessage,
	verifyMessage,
} from "@yonder/protocol";
import { tempHome, tempHomeSync } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import { type PairOffer, readDeviceTrust } from "../src/store.js";

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const homes: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
	for (const child of children.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			await once(child, "exit");
		}
	}
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const run = (args: string[], payload?: unknown) =>
	JSON.parse(
		execFileSync(process.execPath, [cli, ...args], {
			encoding: "utf8",
			...(payload === undefined ? {} : { input: JSON.stringify(payload) }),
		}),
	) as Record<string, unknown>;

function describeRequest(binding: Pick<RpcRequest, "requestId" | "principalId" | "deviceId">): RpcRequest {
	const issuedAt = Date.now();
	return {
		protocol: "yonder.execution",
		version: 1,
		kind: "request",
		...binding,
		issuedAt,
		expiresAt: issuedAt + MAX_MESSAGE_AGE_MS,
		method: "device.describe",
		params: {},
	};
}

function decodeResponse(status: number | undefined, body: Buffer): SignedEnvelope {
	if (status !== 200)
		throw new Error(`Execution HTTP status ${status ?? "unknown"}; ${body.length} bytes; outcome unconfirmed`);
	try {
		return JSON.parse(body.toString()) as SignedEnvelope;
	} catch {
		throw new Error(`Invalid execution JSON response; ${body.length} bytes; outcome unconfirmed`);
	}
}

test("CLI request retains a valid authorization window when the clock ticks between reads", () => {
	const keys = generateKeyPairSync("ed25519"),
		now = 1_700_000_000_000;
	const clock = vi
		.spyOn(Date, "now")
		.mockReturnValueOnce(now)
		.mockReturnValue(now + 1);
	try {
		const request = describeRequest({
			requestId: randomUUID(),
			principalId: publicKeyId(keys.publicKey),
			deviceId: randomUUID(),
		});
		expect(request.expiresAt - request.issuedAt).toBe(MAX_MESSAGE_AGE_MS);
		expect(
			verifyMessage(signMessage(request, keys.privateKey), keys.publicKey, {
				kind: "request",
				principalId: request.principalId,
				deviceId: request.deviceId,
				now: now + 1,
			}),
		).toEqual(request);
	} finally {
		clock.mockRestore();
	}
});

test("CLI HTTP rejection reports status without parsing or disclosing an unauthenticated body", () => {
	expect(() => decodeResponse(400, Buffer.alloc(0))).toThrow("Execution HTTP status 400; 0 bytes; outcome unconfirmed");
	const secret = "private response body";
	expect(() => decodeResponse(400, Buffer.from(secret))).toThrow(
		`Execution HTTP status 400; ${secret.length} bytes; outcome unconfirmed`,
	);
	expect(() => decodeResponse(200, Buffer.alloc(0))).toThrow(
		"Invalid execution JSON response; 0 bytes; outcome unconfirmed",
	);
});

function post(url: string, packet: SignedEnvelope, fingerprint: string): Promise<SignedEnvelope> {
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{ method: "POST", rejectUnauthorized: false, headers: { "content-type": "application/json" } },
			(res) => {
				const certificate = (res.socket as TLSSocket).getPeerCertificate(true);
				if (!certificate.raw || createHash("sha256").update(certificate.raw).digest("hex") !== fingerprint) {
					req.destroy(new Error("TLS_FINGERPRINT_MISMATCH"));
					return;
				}
				const chunks: Buffer[] = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.once("error", reject);
				res.on("end", () => {
					try {
						resolve(decodeResponse(res.statusCode, Buffer.concat(chunks)));
					} catch (error) {
						reject(error);
					}
				});
			},
		);
		req.on("error", reject);
		req.end(JSON.stringify(packet));
	});
}

test("independent CLI pairs both homes, starts HTTPS daemon, serves signed RPC and stops", async () => {
	const root = tempHomeSync("yonder-w1-cli-");
	homes.push(root);
	const deviceHome = join(root, "device"),
		controllerHome = join(root, "controller");
	const key = join(root, "tls-key.pem"),
		cert = join(root, "tls-cert.pem");
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"ed25519",
			"-keyout",
			key,
			"-out",
			cert,
			"-nodes",
			"-subj",
			"/CN=127.0.0.1",
			"-days",
			"1",
			"-addext",
			"subjectAltName=IP:127.0.0.1",
		],
		{ stdio: "ignore" },
	);
	const identity = run(["init", "--home", deviceHome]);
	const offer = run(["pair", "start", "--home", deviceHome, "--tls-cert", cert]) as unknown as PairOffer;
	const proof = run(["pair", "connect", "--phase", "prepare", "--home", controllerHome], {
		offer,
		code: offer.code,
		deviceFingerprint: offer.deviceFingerprint,
		tlsFingerprint: offer.tlsFingerprint,
	});
	const grant: Grant = {
		grantId: randomUUID(),
		deviceId: offer.deviceId,
		principalId: String(proof.controllerFingerprint),
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
	const confirmation = run(["pair", "approve", "--home", deviceHome], { proof, code: offer.code, grants: [grant] });
	const provider = join(root, "provider.mjs");
	writeFileSync(
		provider,
		`export function createBackendProvider() { return { describe: async () => ({ schemaVersion: 1, deviceId: ${JSON.stringify(offer.deviceId)}, role: "execution-only", os: { name: "test", version: "1" }, hostArch: "test", processArch: "test", runtimeVersion: process.version, targets: [{ id: "local", name: "Local" }], capabilities: [], resources: { observedAt: null }, apps: { observedAt: null, status: "unsupported", complete: false }, lastSeenAt: null, health: "ready", routes: [], checkpointRestore: "unsupported" }), apps: async targetId => ({ deviceId: ${JSON.stringify(offer.deviceId)}, targetId, observedAt: new Date().toISOString(), status: "unsupported", complete: false, items: [] }), snapshot: async session => ({ deviceId: ${JSON.stringify(offer.deviceId)}, deviceSessionId: session.deviceSessionId, targetId: session.targetId, observedAt: new Date().toISOString(), status: "unsupported" }), actions: {} }; }`,
	);
	const unavailableToken = join(root, "unavailable-card-token"),
		cardConfig = join(root, "unavailable-card.json");
	writeFileSync(unavailableToken, "temporary-unreachable-card-credential", { mode: 0o600 });
	writeFileSync(
		cardConfig,
		JSON.stringify({
			baseUrl: "http://127.0.0.1:1",
			peerDeviceId: randomUUID(),
			tokenFile: unavailableToken,
			allowInsecureLoopback: true,
		}),
	);
	const child = spawn(
		process.execPath,
		[
			cli,
			"serve",
			"--home",
			deviceHome,
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
			"--card-config",
			cardConfig,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	children.push(child);
	let daemonStderr = "";
	const ready = await new Promise<Record<string, string>>((resolve, reject) => {
		let data = "";
		let error = "";
		child.stdout?.on("data", (chunk) => {
			data += chunk.toString();
			if (data.includes("\n")) resolve(JSON.parse(data.trim()) as Record<string, string>);
		});
		child.stderr?.on("data", (chunk) => {
			error += chunk.toString();
			daemonStderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("exit", () => reject(new Error(error || "daemon exited before ready")));
	});
	expect(ready.deviceId).toBe(identity.deviceId);
	expect(ready.tlsFingerprint).toBe(offer.tlsFingerprint);
	run(["pair", "connect", "--phase", "finish", "--home", controllerHome], {
		pairingId: offer.pairingId,
		confirmation,
		direct: { url: ready.url, tlsFingerprint: ready.tlsFingerprint },
	});
	const trust = readDeviceTrust(controllerHome, offer.deviceId);
	expect(trust.direct?.url).toBe(ready.url);
	const controllerKey = createPrivateKey(readFileSync(join(controllerHome, "controller-key.pem")));
	const requestId = randomUUID();
	const rpc = describeRequest({ requestId, principalId: grant.principalId, deviceId: offer.deviceId });
	if (!ready.url || !trust.direct) throw new Error("missing direct route");
	const answer = await post(ready.url, signMessage(rpc, controllerKey), trust.direct.tlsFingerprint).catch((error) => {
		const diagnostics = daemonStderr.split("\n").flatMap((line) => {
			try {
				const value = JSON.parse(line).executionDiagnostic;
				if (
					!value ||
					!["authentication", "persistence"].includes(value.stage) ||
					![
						"key-id",
						"principal",
						"signature",
						"invalid-now",
						"future",
						"expired",
						"invalid-window",
						"rejected",
						"EACCES",
						"EPERM",
						"EIO",
						"ENOSPC",
						"EROFS",
						"failed",
					].includes(value.reason)
				)
					return [];
				return [
					{
						stage: value.stage,
						reason: value.reason,
						...(Number.isSafeInteger(value.offsetMs) ? { offsetMs: value.offsetMs } : {}),
					},
				];
			} catch {
				return [];
			}
		});
		throw new Error(JSON.stringify({ message: error instanceof Error ? error.message : "RPC failed", diagnostics }));
	});
	const response = verifyMessage(
		answer,
		createPublicKey({ key: Buffer.from(trust.publicKey, "base64"), format: "der", type: "spki" }),
		{ kind: "response", requestId, principalId: grant.principalId, deviceId: offer.deviceId, now: Date.now() },
	) as RpcResponse;
	expect(response.ok).toBe(true);
	// The old two-clock-read fixture could sign this overlong window; the real daemon must reject it.
	await expect(
		post(
			ready.url,
			signMessage({ ...rpc, requestId: randomUUID(), expiresAt: rpc.issuedAt + MAX_MESSAGE_AGE_MS + 1 }, controllerKey),
			trust.direct.tlsFingerprint,
		),
	).rejects.toThrow("Execution HTTP status 400; 0 bytes; outcome unconfirmed");
	await expect.poll(() => daemonStderr.includes('"reason":"invalid-window"')).toBe(true);

	child.kill("SIGTERM");
	await once(child, "exit");
	expect(run(["peers", "list", "--home", deviceHome])).toEqual([grant.principalId]);
});
