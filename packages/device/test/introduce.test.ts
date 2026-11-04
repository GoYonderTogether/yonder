import { createPublicKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	attestationKey,
	encodeCommand,
	publicKeyId,
	type RpcRequest,
	type RpcResponse,
	signAttestation,
	signMessage,
	verifyMessage,
} from "@yonder/protocol";
import { afterEach, expect, test } from "vitest";
import type { BackendProvider } from "../src/backend-provider.js";
import { DeviceExecutor } from "../src/executor.js";

const homes: string[] = [];
const executors: DeviceExecutor[] = [];
afterEach(async () => {
	for (const executor of executors.splice(0)) await executor.close();
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
const tempHome = () => {
	const path = mkdtempSync(join(tmpdir(), "yonder-introduce-"));
	homes.push(path);
	return path;
};

function provider(deviceId: () => string): BackendProvider {
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
			observedAt: null,
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
				resources: () => ({ readRoots: [], writeRoots: [] }),
				execute: async () => ({ written: true }),
			},
		},
	};
}

const TOKEN = "executor-inbox-token-for-introduce-tests";
const OWNER = randomUUID();
const CLOUD_DEVICE = randomUUID();
const BOT = randomUUID();

function setup() {
	let executor!: DeviceExecutor;
	const home = tempHome();
	executor = new DeviceExecutor(
		home,
		provider(() => executor.deviceId),
	);
	executors.push(executor);
	const key = attestationKey(TOKEN);
	executor.rememberCloud({ ownerId: OWNER, cloudDeviceId: CLOUD_DEVICE }, key);
	const pair = generateKeyPairSync("ed25519");
	return { executor, home, key, pair, principalId: publicKeyId(pair.publicKey) };
}

function introduceRequest(input: {
	executor: DeviceExecutor;
	pair: ReturnType<typeof generateKeyPairSync>;
	principalId: string;
	overrides?: Partial<{
		capabilities: string[];
		actions: string[];
		targetIds: string[];
		botId: string | null;
		readRoots: string[];
	}>;
}) {
	const now = Date.now();
	const params = {
		controllerPublicKey: input.pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
		label: "Test Bot",
		botId: BOT,
		capabilities: ["read", "write"],
		targetIds: ["local"],
		actions: ["file.write"],
		readRoots: [],
		writeRoots: [],
		...input.overrides,
	};
	const request = {
		protocol: "yonder.execution",
		version: 1,
		kind: "request",
		requestId: randomUUID(),
		principalId: input.principalId,
		deviceId: input.executor.deviceId,
		issuedAt: now,
		expiresAt: now + 30_000,
		method: "device.introduce",
		params,
	} as RpcRequest;
	return signMessage(request, input.pair.privateKey);
}

function attestation(
	key: Buffer,
	executorDeviceId: string,
	overrides: Partial<{ action: "introduce" | "revoke" | "policy"; subject: string; cloudDeviceId: string }> = {},
) {
	return signAttestation(key, {
		ownerId: OWNER,
		cloudDeviceId: CLOUD_DEVICE,
		executorDeviceId,
		action: "introduce",
		subject: publicKeyId(generateKeyPairSync("ed25519").publicKey),
		issuedAt: Date.now(),
		expiresAt: Date.now() + 60_000,
		...overrides,
	});
}

/** The executor signs responses with its own key; verify exactly as a controller would. */
function parseResponse(
	envelope: unknown,
	executor: DeviceExecutor,
	principalId: string,
	requestId: string,
): RpcResponse {
	return verifyMessage(envelope, createPublicKey(executor.store.key), {
		kind: "response",
		principalId,
		deviceId: executor.deviceId,
		requestId,
		now: Date.now(),
	}) as RpcResponse;
}

test("a same-owner introduction issues a grant the executor decided, and repeats are idempotent", async () => {
	const { executor, key, pair, principalId } = setup();
	const claim = attestation(key, executor.deviceId, { subject: principalId });
	const request = introduceRequest({ executor, pair, principalId });
	const requestId = JSON.parse(
		Buffer.from((request as { payloadBase64: string }).payloadBase64, "base64").toString(),
	).requestId;
	const verified = parseResponse(await executor.introduce(request, claim), executor, principalId, requestId);
	expect(verified.ok).toBe(true);
	const grant = (
		verified as {
			result: {
				grant: {
					grantId: string;
					botId: string;
					capabilities: string[];
					targetIds: string[];
					readRoots: string[];
					source: string;
				};
			};
		}
	).result.grant;
	expect(grant).toMatchObject({ botId: BOT, capabilities: ["read", "write"], targetIds: ["local"], source: "cloud" });
	// No roots were requested: the executor applies its own home, canonicalized.
	expect(grant.readRoots).toHaveLength(1);
	const again = await executor.introduce(
		introduceRequest({ executor, pair, principalId }),
		attestation(key, executor.deviceId, { subject: principalId }),
	);
	const repeated = JSON.parse(
		Buffer.from((again as { payloadBase64: string }).payloadBase64, "base64").toString(),
	) as RpcResponse;
	expect((repeated as { result: { grant: { grantId: string } } }).result.grant.grantId).toBe(grant.grantId);
	expect(executor.summaries()).toHaveLength(1);
});

test("an attestation for another executor, owner, subject or action is refused", async () => {
	const { executor, key, pair, principalId } = setup();
	const envelope = () => introduceRequest({ executor, pair, principalId });
	for (const claim of [
		attestation(key, executor.deviceId, { subject: publicKeyId(generateKeyPairSync("ed25519").publicKey) }),
		attestation(key, executor.deviceId, { cloudDeviceId: randomUUID() }),
		attestation(key, executor.deviceId, { action: "revoke", subject: principalId }),
		signAttestation(attestationKey("another-token"), {
			ownerId: OWNER,
			cloudDeviceId: CLOUD_DEVICE,
			executorDeviceId: executor.deviceId,
			action: "introduce",
			subject: principalId,
			issuedAt: Date.now(),
			expiresAt: Date.now() + 60_000,
		}),
	]) {
		const response = (await executor.introduce(envelope(), claim)) as { payloadBase64: string };
		const parsed = JSON.parse(Buffer.from(response.payloadBase64, "base64").toString()) as RpcResponse;
		expect(parsed.ok).toBe(false);
	}
	expect(executor.summaries()).toHaveLength(0);
});

test("an unregistered or unsupported target/action is refused instead of silently narrowed", async () => {
	const { executor, key, pair, principalId } = setup();
	const claim = () => attestation(key, executor.deviceId, { subject: principalId });
	for (const overrides of [{ actions: ["fs.exec"] }, { targetIds: ["elsewhere"] }]) {
		const response = (await executor.introduce(
			introduceRequest({ executor, pair, principalId, overrides }),
			claim(),
		)) as {
			payloadBase64: string;
		};
		const parsed = JSON.parse(Buffer.from(response.payloadBase64, "base64").toString()) as RpcResponse;
		expect(parsed.ok).toBe(false);
		expect((parsed as { error: { code: string } }).error.code).toBe("UNSUPPORTED_OPERATION");
	}
});

test("manual-only refuses introductions and keeps manual pairing intact", async () => {
	const { executor, key, pair, principalId, home } = setup();
	executor.store.setPolicy("manual-only");
	const response = (await executor.introduce(
		introduceRequest({ executor, pair, principalId }),
		attestation(key, executor.deviceId, { subject: principalId }),
	)) as {
		payloadBase64: string;
	};
	const parsed = JSON.parse(Buffer.from(response.payloadBase64, "base64").toString()) as RpcResponse;
	expect(parsed).toMatchObject({ ok: false, error: { code: "UNPAIRED" } });
	expect(executor.summaries()).toHaveLength(0);
	// The offline pairing offer still works from the same home.
	const offer = executor.store.beginPairing();
	expect(offer.deviceId).toBe(executor.deviceId);
	expect(offer.code).toHaveLength(32);
	void home;
});

test("the allow table narrows a Bot and revokes what it already had; re-allowing does not undo an owner revocation", async () => {
	const { executor, key, pair, principalId } = setup();
	const response = (await executor.introduce(
		introduceRequest({ executor, pair, principalId }),
		attestation(key, executor.deviceId, { subject: principalId }),
	)) as {
		payloadBase64: string;
	};
	const grant = (
		JSON.parse(Buffer.from(response.payloadBase64, "base64").toString()) as { result: { grant: { grantId: string } } }
	).result.grant;
	// Another device is allowed, this one is not: the grant is revoked.
	executor.applyAllowance(BOT, [randomUUID()]);
	expect(executor.summaries()[0]).toMatchObject({ grantId: grant.grantId, revokedAt: expect.any(String) });
	// A repeat introduction is refused while the allow table excludes this device.
	const blocked = (await executor.introduce(
		introduceRequest({ executor, pair, principalId }),
		attestation(key, executor.deviceId, { subject: principalId }),
	)) as {
		payloadBase64: string;
	};
	expect(JSON.parse(Buffer.from(blocked.payloadBase64, "base64").toString())).toMatchObject({ ok: false });
	// Restating the allow table makes an introduction possible again.
	executor.applyAllowance(BOT, null);
	const fresh = (await executor.introduce(
		introduceRequest({ executor, pair, principalId }),
		attestation(key, executor.deviceId, { subject: principalId }),
	)) as {
		payloadBase64: string;
	};
	expect(JSON.parse(Buffer.from(fresh.payloadBase64, "base64").toString())).toMatchObject({ ok: true });
	// An owner revocation outranks a later introduction until the cloud restates the table.
	executor.revokeGrant(grant.grantId);
	const revoked = (await executor.introduce(
		introduceRequest({ executor, pair, principalId }),
		attestation(key, executor.deviceId, { subject: principalId }),
	)) as {
		payloadBase64: string;
	};
	expect(JSON.parse(Buffer.from(revoked.payloadBase64, "base64").toString())).toMatchObject({
		ok: false,
		error: { code: "GRANT_REVOKED" },
	});
	executor.applyAllowance(BOT, null);
	const restored = (await executor.introduce(
		introduceRequest({ executor, pair, principalId }),
		attestation(key, executor.deviceId, { subject: principalId }),
	)) as {
		payloadBase64: string;
	};
	expect(JSON.parse(Buffer.from(restored.payloadBase64, "base64").toString())).toMatchObject({ ok: true });
});

test("each paired principal sees only its own grants, and a principal without a grant cannot act", async () => {
	const { executor, key, pair, principalId } = setup();
	await executor.introduce(
		introduceRequest({ executor, pair, principalId }),
		attestation(key, executor.deviceId, { subject: principalId }),
	);
	const other = generateKeyPairSync("ed25519");
	const otherPrincipal = publicKeyId(other.publicKey);
	await executor.introduce(
		introduceRequest({ executor, pair: other, principalId: otherPrincipal }),
		attestation(key, executor.deviceId, { subject: otherPrincipal }),
	);
	// Summaries keep both principals apart; the RPC filters to the caller.
	expect(executor.summaries().filter((grant) => grant.principalId === principalId)).toHaveLength(1);
	expect(executor.summaries().filter((grant) => grant.principalId === otherPrincipal)).toHaveLength(1);
	// A controller the cloud never introduced is UNPAIRED even with a valid signature.
	const stranger = generateKeyPairSync("ed25519");
	const strangerPrincipal = publicKeyId(stranger.publicKey);
	const now = Date.now();
	await expect(
		executor.handle(
			signMessage(
				{
					protocol: "yonder.execution",
					version: 1,
					kind: "request",
					requestId: randomUUID(),
					principalId: strangerPrincipal,
					deviceId: executor.deviceId,
					issuedAt: now,
					expiresAt: now + 30_000,
					method: "grants.list",
					params: {},
				} as RpcRequest,
				stranger.privateKey,
			),
		),
	).rejects.toThrow("UNPAIRED");
});
