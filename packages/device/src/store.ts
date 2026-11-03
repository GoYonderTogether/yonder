import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	type KeyObject,
	randomBytes,
	randomUUID,
	sign,
	verify,
} from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	type CommandReceipt,
	type DeviceSession,
	type Grant,
	GrantSchema,
	publicKeyId,
	recoveredCommandState,
} from "@yonder/protocol";
import { Check } from "typebox/value";

export interface PairOffer {
	tlsFingerprint?: string;
	pairingId: string;
	code: string;
	deviceId: string;
	devicePublicKey: string;
	deviceFingerprint: string;
	expiresAt: string;
}
export interface PairProof {
	pairingId: string;
	controllerPublicKey: string;
	controllerFingerprint: string;
	signature: string;
}
export interface DirectRoute {
	url: string;
	tlsFingerprint: string;
}
export interface DeviceTrustRecord {
	deviceId: string;
	publicKey: string;
	fingerprint: string;
	direct?: DirectRoute;
}
export interface PairConfirmation {
	pairingId: string;
	principalId: string;
	deviceId: string;
	signature: string;
}
export interface CommandRecord {
	receipt: CommandReceipt;
	commandBase64: string;
	targetId: string;
	action: string;
	readRoots: string[];
	writeRoots: string[];
}
interface PairPending {
	offer: PairOffer;
}
export type PairingPolicy = "cloud-or-manual" | "manual-only";
/** What this executor learned about its own cloud registration from its inbox connection. */
export interface CloudIdentity {
	ownerId: string;
	cloudDeviceId: string;
}
export interface StoreData {
	deviceId: string;
	privateKey: string;
	peers: Record<string, string>;
	grants: Record<string, Grant>;
	sessions: Record<string, DeviceSession>;
	leaseEpochs: Record<string, number>;
	commands: Record<string, CommandRecord>;
	requests: Record<string, { digest: string; response: unknown }>;
	pending: Record<string, PairPending>;
	/** Absent means the default: cloud-introduced pairing is allowed. */
	pairingPolicy?: PairingPolicy;
	cloud?: CloudIdentity;
	/**
	 * Per-Bot allow table mirrored from the cloud: a list of cloud device UUIDs, `null` for
	 * "all devices", or absent for "no statement yet" (treated as all).
	 */
	allowance?: Record<string, string[] | null>;
}
const iso = () => new Date().toISOString();
const fingerprint = (key: KeyObject) => publicKeyId(key);
const pub = (key: KeyObject) =>
	(key.type === "public" ? key : createPublicKey(key)).export({ format: "der", type: "spki" }).toString("base64");
const privateKey = (key: KeyObject) => key.export({ format: "pem", type: "pkcs8" }).toString();
const keyFromPublic = (der: string) =>
	createPublicKey({ key: Buffer.from(der, "base64"), format: "der", type: "spki" });
const challenge = (offer: PairOffer) =>
	Buffer.from(
		JSON.stringify([
			offer.pairingId,
			offer.deviceId,
			offer.deviceFingerprint,
			offer.code,
			offer.tlsFingerprint ?? null,
		]),
	);

/** All mutations are durable before returning; one daemon owns one home. */
export class ExecutorStore {
	readonly data: StoreData;
	readonly key: KeyObject;
	private readonly daemonLock: DatabaseSync;
	private closed = false;
	constructor(readonly home: string) {
		mkdirSync(home, { recursive: true, mode: 0o700 });
		this.daemonLock = this.lock();
		try {
			const file = join(home, "state.json");
			if (existsSync(file)) this.data = JSON.parse(readFileSync(file, "utf8")) as StoreData;
			else {
				const pair = generateKeyPairSync("ed25519");
				this.data = {
					deviceId: randomUUID(),
					privateKey: privateKey(pair.privateKey),
					peers: {},
					grants: {},
					sessions: {},
					leaseEpochs: {},
					commands: {},
					requests: {},
					pending: {},
				};
				this.save();
			}
			this.key = createPrivateKey(this.data.privateKey);
			for (const record of Object.values(this.data.commands))
				record.receipt.state = recoveredCommandState(record.receipt.state);
			this.save();
		} catch (error) {
			this.close();
			throw error;
		}
	}
	private lock(): DatabaseSync {
		// Old daemons do not take the SQLite lock; never reclaim their directory automatically.
		if (existsSync(join(this.home, "daemon.lock"))) throw new Error("BUSY");
		const db = new DatabaseSync(join(this.home, "daemon-lock.sqlite"));
		try {
			db.exec("PRAGMA busy_timeout=250; BEGIN EXCLUSIVE");
			return db;
		} catch (error) {
			db.close();
			if ((error as { errcode?: number }).errcode === 5) throw new Error("BUSY");
			throw error;
		}
	}
	save(): void {
		if (this.closed) throw new Error("BUSY");
		const target = join(this.home, "state.json");
		const temp = join(this.home, `.state-${randomUUID()}`);
		const fd = openSync(temp, "wx", 0o600);
		try {
			writeFileSync(fd, JSON.stringify(this.data));
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(temp, target);
		// Windows does not support fsync on directory handles; the file itself was flushed above.
		if (process.platform !== "win32") {
			const dir = openSync(this.home, "r");
			try {
				fsyncSync(dir);
			} finally {
				closeSync(dir);
			}
		}
	}
	close(): void {
		if (!this.closed) {
			this.closed = true;
			this.daemonLock.close();
		}
	}
	beginPairing(ttlMs = 300_000, tlsFingerprint?: string): PairOffer {
		if (ttlMs <= 0 || ttlMs > 300_000) throw new Error("INVALID_REQUEST");
		const offer: PairOffer = {
			pairingId: randomUUID(),
			code: randomBytes(16).toString("hex"),
			deviceId: this.data.deviceId,
			devicePublicKey: pub(this.key),
			deviceFingerprint: fingerprint(this.key),
			expiresAt: new Date(Date.now() + ttlMs).toISOString(),
			...(tlsFingerprint ? { tlsFingerprint } : {}),
		};
		this.data.pending[offer.pairingId] = { offer };
		this.save();
		return offer;
	}
	approvePairing(proof: PairProof, code: string, grants: Grant[]): PairConfirmation {
		const pending = this.data.pending[proof.pairingId];
		if (!pending || Date.parse(pending.offer.expiresAt) <= Date.now() || pending.offer.code !== code)
			throw new Error("UNAUTHORIZED");
		const controller = keyFromPublic(proof.controllerPublicKey);
		const principalId = fingerprint(controller);
		if (
			proof.controllerFingerprint !== principalId ||
			!verify(null, challenge(pending.offer), controller, Buffer.from(proof.signature, "base64"))
		)
			throw new Error("UNAUTHORIZED");
		for (const grant of grants) {
			if (
				!Check(GrantSchema, grant) ||
				grant.deviceId !== this.data.deviceId ||
				grant.principalId !== principalId ||
				grant.revokedAt ||
				Date.parse(grant.expiresAt) <= Date.now()
			)
				throw new Error("UNAUTHORIZED");
		}
		this.data.peers[principalId] = proof.controllerPublicKey;
		for (const grant of grants) this.data.grants[grant.grantId] = grant;
		delete this.data.pending[proof.pairingId];
		this.save();
		const confirmation = { pairingId: proof.pairingId, principalId, deviceId: this.data.deviceId };
		return {
			...confirmation,
			signature: sign(null, Buffer.from(JSON.stringify(confirmation)), this.key).toString("base64"),
		};
	}
	revoke(principalId: string, grantId: string, persist = true): void {
		const grant = this.data.grants[grantId];
		if (!grant || grant.principalId !== principalId) throw new Error("UNAUTHORIZED");
		if (!grant.revokedAt) {
			grant.revokedAt = iso();
			grant.revision++;
			if (persist) this.save();
		}
	}
	/**
	 * Owner-initiated revocation (executor CLI or the cloud relay on the owner's behalf).
	 * It does not need a principal because it is a withdrawal, never a grant.
	 */
	revokeAny(grantId: string): void {
		const grant = this.data.grants[grantId];
		if (!grant) throw new Error("COMMAND_NOT_FOUND");
		if (grant.revokedAt) return;
		grant.revokedAt = iso();
		grant.revision++;
		this.save();
	}
	get pairingPolicy(): PairingPolicy {
		return this.data.pairingPolicy ?? "cloud-or-manual";
	}
	setPolicy(policy: PairingPolicy): void {
		if (policy !== "cloud-or-manual" && policy !== "manual-only") throw new Error("INVALID_REQUEST");
		this.data.pairingPolicy = policy;
		this.save();
	}
	rememberCloud(identity: CloudIdentity): void {
		if (!/^[a-f0-9-]{36}$/.test(identity.ownerId) || !/^[a-f0-9-]{36}$/.test(identity.cloudDeviceId))
			throw new Error("INVALID_REQUEST");
		this.data.cloud = { ownerId: identity.ownerId, cloudDeviceId: identity.cloudDeviceId };
		this.save();
	}
	/**
	 * Issues a grant for a controller the cloud introduced. The caller has already verified the
	 * attestation; this only decides what may be granted locally.
	 */
	introduce(input: {
		principalId: string;
		publicKey: string;
		botId: string | null;
		label: string;
		capabilities: Grant["capabilities"];
		targetIds: string[];
		actions: string[];
		readRoots: string[];
		writeRoots: string[];
		ttlMs?: number;
	}): Grant | undefined {
		const capabilities = [...new Set(input.capabilities)];
		const targetIds = [...new Set(input.targetIds)];
		const readRoots = [...new Set(input.readRoots)];
		const writeRoots = [...new Set(input.writeRoots)];
		if (!capabilities.length || !targetIds.length) return undefined;
		const existing = Object.values(this.data.grants).find(
			(g) =>
				g.deviceId === this.data.deviceId &&
				g.principalId === input.principalId &&
				!g.revokedAt &&
				Date.parse(g.expiresAt) > Date.now() &&
				g.botId === input.botId &&
				sameSet(g.capabilities, capabilities) &&
				sameSet(g.targetIds, targetIds) &&
				sameSet(g.actions, input.actions) &&
				sameSet(g.readRoots, readRoots) &&
				sameSet(g.writeRoots, writeRoots),
		);
		// Repeat introductions must not mint a second grant for the same authority.
		if (existing) return existing;
		const issuedAt = iso();
		const grant: Grant = {
			grantId: randomUUID(),
			deviceId: this.data.deviceId,
			principalId: input.principalId,
			revision: 1,
			capabilities,
			targetIds,
			actions: [...new Set(input.actions)],
			readRoots,
			writeRoots,
			issuedAt,
			expiresAt: new Date(Date.now() + (input.ttlMs ?? 24 * 60 * 60_000)).toISOString(),
			revokedAt: null,
			botId: input.botId,
			label: input.label,
			source: "cloud",
		};
		if (!Check(GrantSchema, grant)) throw new Error("INVALID_REQUEST");
		this.data.peers[input.principalId] = input.publicKey;
		this.data.grants[grant.grantId] = grant;
		this.save();
		return grant;
	}
	/** A Bot may address this device only if the mirrored allow table still includes it. */
	allows(botId: string | null | undefined, cloudDeviceId: string): boolean {
		if (!botId) return false;
		const value = this.data.allowance?.[botId];
		return value === undefined || value === null || value.includes(cloudDeviceId);
	}
	/** Mirrors the cloud's allow table and revokes grants that just became disallowed. */
	applyAllowance(botId: string, devices: string[] | null): string[] {
		if (!/^[a-f0-9-]{36}$/.test(botId) || (devices !== null && !devices.every((d) => /^[a-f0-9-]{36}$/.test(d))))
			throw new Error("INVALID_REQUEST");
		this.data.allowance = { ...this.data.allowance, [botId]: devices === null ? null : [...new Set(devices)] };
		const revoked: string[] = [];
		if (!this.allows(botId, this.data.cloud?.cloudDeviceId ?? ""))
			for (const grant of Object.values(this.data.grants))
				if (grant.botId === botId && grant.source === "cloud" && !grant.revokedAt) {
					grant.revokedAt = iso();
					grant.revision++;
					revoked.push(grant.grantId);
				}
		this.save();
		return revoked;
	}
	/** Summaries the owner and the controller may read; never a capability to use them. */
	summaries(): Grant[] {
		return Object.values(this.data.grants).map((grant) => structuredClone(grant));
	}
}

/** Controller data lives only in its own private home; no Card token is consulted. */
export class ControllerPairing {
	privateKey: string;
	constructor(readonly home: string) {
		mkdirSync(home, { recursive: true, mode: 0o700 });
		const path = join(home, "controller-key.pem");
		if (existsSync(path)) this.privateKey = readFileSync(path, "utf8");
		else {
			this.privateKey = privateKey(generateKeyPairSync("ed25519").privateKey);
			writeFileSync(path, this.privateKey, { flag: "wx", mode: 0o600 });
		}
	}
	prove(offer: PairOffer, code: string, expectedDeviceFingerprint: string, expectedTlsFingerprint?: string): PairProof {
		if (
			offer.code !== code ||
			offer.deviceFingerprint !== expectedDeviceFingerprint ||
			(offer.tlsFingerprint !== undefined && offer.tlsFingerprint !== expectedTlsFingerprint) ||
			Date.parse(offer.expiresAt) <= Date.now() ||
			fingerprint(keyFromPublic(offer.devicePublicKey)) !== expectedDeviceFingerprint
		)
			throw new Error("UNAUTHORIZED");
		const key = createPrivateKey(this.privateKey);
		const pendingPath = join(this.home, `pending-${offer.pairingId}.json`);
		if (existsSync(pendingPath)) {
			if (readFileSync(pendingPath, "utf8") !== JSON.stringify(offer)) throw new Error("COMMAND_CONFLICT");
		} else writeFileSync(pendingPath, JSON.stringify(offer), { flag: "wx", mode: 0o600 });
		return {
			pairingId: offer.pairingId,
			controllerPublicKey: pub(key),
			controllerFingerprint: fingerprint(key),
			signature: sign(null, challenge(offer), key).toString("base64"),
		};
	}
	finish(offer: PairOffer, confirmation: PairConfirmation, direct?: DirectRoute): void {
		if (direct && (new URL(direct.url).protocol !== "https:" || direct.tlsFingerprint !== offer.tlsFingerprint))
			throw new Error("UNAUTHORIZED");
		const { signature, ...content } = confirmation;
		if (
			confirmation.pairingId !== offer.pairingId ||
			confirmation.deviceId !== offer.deviceId ||
			confirmation.principalId !== fingerprint(createPrivateKey(this.privateKey)) ||
			!verify(
				null,
				Buffer.from(JSON.stringify(content)),
				keyFromPublic(offer.devicePublicKey),
				Buffer.from(signature, "base64"),
			)
		)
			throw new Error("UNAUTHORIZED");
		writeFileSync(
			join(this.home, `device-${offer.deviceId}.json`),
			JSON.stringify({
				deviceId: offer.deviceId,
				publicKey: offer.devicePublicKey,
				fingerprint: offer.deviceFingerprint,
				...(direct ? { direct } : {}),
			}),
			{ flag: "wx", mode: 0o600 },
		);
		rmSync(join(this.home, `pending-${offer.pairingId}.json`), { force: true });
	}
}

export function readDeviceTrust(home: string, deviceId: string): DeviceTrustRecord {
	if (!/^[a-f0-9-]{36}$/.test(deviceId)) throw new Error("INVALID_REQUEST");
	return JSON.parse(readFileSync(join(home, `device-${deviceId}.json`), "utf8")) as DeviceTrustRecord;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");
