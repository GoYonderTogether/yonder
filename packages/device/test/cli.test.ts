import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import {
	type Grant,
	type RpcRequest,
	type RpcResponse,
	type SignedEnvelope,
	signMessage,
	verifyMessage,
} from "@yonder/protocol";
import { afterEach, expect, test } from "vitest";
import { type PairOffer, readDeviceTrust } from "../src/store.js";

const cli = new URL("../dist/cli.js", import.meta.url).pathname;
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
				res.on("end", () => {
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString()) as SignedEnvelope);
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
	const root = mkdtempSync(join(tmpdir(), "yonder-w1-cli-"));
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
	const ready = await new Promise<Record<string, string>>((resolve, reject) => {
		let data = "";
		let error = "";
		child.stdout?.on("data", (chunk) => {
			data += chunk.toString();
			if (data.includes("\n")) resolve(JSON.parse(data.trim()) as Record<string, string>);
		});
		child.stderr?.on("data", (chunk) => {
			error += chunk.toString();
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
	const rpc: RpcRequest = {
		protocol: "yonder.execution",
		version: 1,
		kind: "request",
		requestId,
		principalId: grant.principalId,
		deviceId: offer.deviceId,
		issuedAt: Date.now(),
		expiresAt: Date.now() + 60_000,
		method: "device.describe",
		params: {},
	};
	if (!ready.url || !trust.direct) throw new Error("missing direct route");
	const answer = await post(ready.url, signMessage(rpc, controllerKey), trust.direct.tlsFingerprint);
	const response = verifyMessage(
		answer,
		createPublicKey({ key: Buffer.from(trust.publicKey, "base64"), format: "der", type: "spki" }),
		{ kind: "response", requestId, principalId: grant.principalId, deviceId: offer.deviceId, now: Date.now() },
	) as RpcResponse;
	expect(response.ok).toBe(true);
	child.kill("SIGTERM");
	await once(child, "exit");
	expect(run(["peers", "list", "--home", deviceHome])).toEqual([grant.principalId]);
});
