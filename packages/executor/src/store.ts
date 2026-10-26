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
} from "@yonder/execution-protocol";
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
		const dir = openSync(this.home, "r");
		try {
			fsyncSync(dir);
		} finally {
			closeSync(dir);
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
