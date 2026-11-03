import { createPrivateKey, createPublicKey, type KeyObject, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
	type Grant,
	GrantSchema,
	type PluginAPI,
	publicKeyId,
	signMessage,
	type TSchema,
	verifyMessage,
} from "@yonder/sdk";
import { Check } from "typebox/value";
import { CardRoute, CloudRoute, directRoute } from "./routes.js";
import { type DeviceRegistry, normalizeResult, type RegisteredDevice, RemoteError } from "./transport.js";

export interface CloudConfig {
	/** Cloud origin, e.g. https://yonderbot.net. */
	baseUrl: string;
	/** Device bearer credential name in yonder.yaml credentials. */
	credential: string;
	/** Bot whose devices this controller may use; defaults to the local agent's cloud account. */
	botId?: string;
	/** Readable name shown to the device owner next to the grant. */
	label?: string;
	allowInsecureLoopback?: boolean;
}
export interface ConnectionConfig {
	pairingHome?: string;
	allowInsecureLoopback?: boolean;
	cloud?: CloudConfig;
	devices?: Array<{
		deviceId: string;
		name: string;
		grants: Grant[];
		direct?: { url: string; tlsFingerprint?: string };
		card?: { baseUrl: string; credential: string; peerDeviceId: string };
	}>;
}
const string = { type: "string", minLength: 1, maxLength: 4096 };
const uuid = { type: "string", pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" };
export const configSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		pairingHome: string,
		allowInsecureLoopback: { type: "boolean", default: false },
		cloud: {
			type: "object",
			additionalProperties: false,
			required: ["baseUrl", "credential"],
			properties: {
				baseUrl: string,
				credential: string,
				botId: uuid,
				label: string,
				allowInsecureLoopback: { type: "boolean" },
			},
		},
		devices: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["deviceId", "name", "grants"],
				properties: {
					deviceId: uuid,
					name: string,
					grants: { type: "array", items: GrantSchema },
					direct: {
						type: "object",
						additionalProperties: false,
						required: ["url"],
						properties: { url: string, tlsFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" } },
					},
					card: {
						type: "object",
						additionalProperties: false,
						required: ["baseUrl", "credential", "peerDeviceId"],
						properties: { baseUrl: string, credential: string, peerDeviceId: uuid },
					},
				},
			},
		},
	},
} as TSchema;

async function privateFile(path: string): Promise<string> {
	const info = await stat(path);
	if (!info.isFile() || (process.platform !== "win32" && (info.mode & 0o077) !== 0))
		throw new Error("Pairing files must be private regular files");
	return readFile(path, "utf8");
}

const der = (key: KeyObject) =>
	(key.type === "public" ? key : createPublicKey(key)).export({ format: "der", type: "spki" }).toString("base64");

/** The paired principal's controller key; it owns every cloud-introduced grant this host gets. */
export async function controllerKey(pairingHome: string): Promise<KeyObject> {
	const path = join(pairingHome, "controller-key.pem");
	try {
		return createPrivateKey(await privateFile(path));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	// Created once per host; never regenerated silently for an existing pairing directory.
	mkdirSync(pairingHome, { recursive: true, mode: 0o700 });
	const { generateKeyPairSync } = await import("node:crypto");
	const key = generateKeyPairSync("ed25519").privateKey;
	await writeFile(path, key.export({ format: "pem", type: "pkcs8" }).toString(), { flag: "wx", mode: 0o600 });
	return key;
}

async function cloudDevices(
	config: CloudConfig,
	token: () => Promise<string>,
	controller: KeyObject,
	allowLoopback: boolean,
	pins: KeyPins,
	refresh: (device: RegisteredDevice) => Promise<Grant[]>,
): Promise<RegisteredDevice[]> {
	const base = new URL(config.baseUrl);
	if (base.pathname !== "/" || base.search || base.hash || base.username || base.password)
		throw new Error("Cloud baseUrl must be an origin");
	if (
		base.protocol !== "https:" &&
		!(allowLoopback && base.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(base.hostname))
	)
		throw new Error("Cloud routes require HTTPS; explicit HTTP is loopback-test only");
	// The device credential lists only this account's devices plus each executor's reported key.
	const listing = await fetch(new URL("/api/device/devices", base), {
		headers: { authorization: `Bearer ${await token()}` },
		redirect: "error",
	});
	if (!listing.ok) {
		await listing.body?.cancel().catch(() => {});
		throw new Error(`Cloud device list failed: HTTP ${listing.status}`);
	}
	const body = (await listing.json()) as { devices?: unknown };
	if (!Array.isArray(body.devices)) throw new Error("Cloud device list is invalid");
	const records: RegisteredDevice[] = [];
	for (const entry of body.devices) {
		if (!entry || typeof entry !== "object") continue;
		const device = entry as { id?: unknown; name?: unknown; executor?: unknown };
		if (typeof device.id !== "string" || !/^[a-f0-9-]{36}$/i.test(device.id)) continue;
		if (typeof device.name !== "string") continue;
		const executor = device.executor as { deviceId?: unknown; publicKey?: unknown } | undefined;
		// Without the executor's own report there is nothing to verify a signed answer against.
		if (!executor || typeof executor.publicKey !== "string" || !executor.publicKey) continue;
		const deviceKey = createPublicKey({ key: Buffer.from(executor.publicKey, "base64"), format: "der", type: "spki" });
		await pins.assert(device.id, executor.publicKey);
		records.push({
			deviceId: device.id,
			name: device.name,
			controllerKey: controller,
			deviceKey,
			executorDeviceId: executor.deviceId as string,
			grants: [],
			routes: [new CloudRoute({ baseUrl: config.baseUrl, deviceId: device.id }, token, allowLoopback)],
			introduce: { label: config.label ?? device.name, botId: config.botId ?? null },
		});
	}
	// The current grant set comes from the executor itself (grants.list), never from configuration.
	for (const record of records) record.grants = await refresh(record);
	return records;
}

/** Pins the executor public key the cloud reports so a later swap is a real error, not a silent trust change. */
export class KeyPins {
	private readonly file: string;
	private loaded: Record<string, string> | undefined;
	constructor(directory: string) {
		this.file = join(directory, "executor-keys.json");
	}
	private async read(): Promise<Record<string, string>> {
		if (this.loaded) return this.loaded;
		try {
			this.loaded = JSON.parse(await readFile(this.file, "utf8")) as Record<string, string>;
		} catch {
			this.loaded = {};
		}
		return this.loaded;
	}
	async assert(deviceId: string, publicKey: string): Promise<void> {
		const pins = await this.read();
		const known = pins[deviceId];
		if (known !== undefined) {
			if (known !== publicKey) throw new Error("Executor public key changed for this device; pairing must be renewed");
			return;
		}
		pins[deviceId] = publicKey;
		mkdirSync(join(this.file, ".."), { recursive: true, mode: 0o700 });
		await writeFile(this.file, JSON.stringify(pins), { mode: 0o600 });
	}
}

/** Reads the W1 ControllerPairing layout, without generating identity or editing its records. */
export function configuredRegistry(
	input: unknown,
	credentials: PluginAPI["credentials"],
	dataDirectory = ".",
): { registry: DeviceRegistry; close(): Promise<void>; prepare(): Promise<void> } {
	const config = input ?? {};
	if (!Check(configSchema, config)) throw new Error("Invalid devices plugin connection configuration");
	const { devices = [], pairingHome, allowInsecureLoopback = false, cloud } = config as ConnectionConfig;
	if ((devices.length && !pairingHome) || (pairingHome && !isAbsolute(pairingHome)))
		throw new Error("Configured devices require an explicit absolute W1 controller pairingHome");
	if (cloud && !isAbsolute(pairingHome ?? ""))
		throw new Error("Cloud discovery requires an explicit absolute controller pairingHome");
	if (new Set(devices.map((d) => d.deviceId)).size !== devices.length)
		throw new Error("Duplicate device configuration");
	const cards = new Map<string, CardRoute>();
	for (const device of devices) {
		if (device.direct) directRoute(device.direct, allowInsecureLoopback);
		if (device.card) {
			const cardConfig = device.card;
			const route = new CardRoute(
				cardConfig,
				async () => {
					const credential = await credentials.get(cardConfig.credential);
					if (!credential || credential.type !== "api_key" || !credential.key)
						throw new Error("Card route requires its configured device bearer credential");
					return credential.key;
				},
				allowInsecureLoopback,
			);
			cards.set(device.deviceId, route);
		}
	}
	async function cardToken(name: string): Promise<string> {
		const credential = await credentials.get(name);
		if (!credential || credential.type !== "api_key" || !credential.key)
			throw new Error("Cloud discovery requires a device bearer credential");
		return credential.key;
	}
	const pins = new KeyPins(dataDirectory);
	const refresh = async (device: RegisteredDevice): Promise<Grant[]> => {
		// Introduce first: until the executor has a peer record it answers every request `UNPAIRED`.
		// It is idempotent and returns the existing grant when the same authority was already issued.
		if (device.introduce) {
			try {
				await rpcOn(device, "device.introduce", {
					controllerPublicKey: der(device.controllerKey),
					label: device.introduce.label,
					botId: device.introduce.botId,
					capabilities: ["read", "write", "exec", "network", "message"],
					targetIds: ["host:filesystem"],
					actions: [
						"fs.stat",
						"fs.canonical",
						"fs.list",
						"fs.read",
						"fs.write",
						"fs.mkdir",
						"fs.remove",
						"fs.rename",
						"fs.truncate",
						"fs.flush",
						"process.exec",
					],
					// Empty means "the executor applies its own default roots"; it is the final judge.
					readRoots: [],
					writeRoots: [],
				});
			} catch (error) {
				// The executor refused: the owner narrowed or revoked this Bot, so it has no grants.
				// That is a real answer, not a discovery failure.
				if (error instanceof RemoteError && ["UNAUTHORIZED", "UNPAIRED", "GRANT_REVOKED"].includes(error.code))
					return [];
				throw error;
			}
		}
		const listed = (await rpcOn(device, "grants.list", {})) as unknown;
		return Array.isArray(listed) ? (listed.filter((grant) => Check(GrantSchema, grant)) as Grant[]) : [];
	};
	/** One signed RPC outside a tool call; the controller's own key signs it. */
	async function rpcOn(device: RegisteredDevice, method: "grants.list" | "device.introduce", params: unknown) {
		const wireDeviceId = device.executorDeviceId ?? device.deviceId;
		const request = {
			protocol: "yonder.execution" as const,
			version: 1 as const,
			kind: "request" as const,
			requestId: randomUUID(),
			principalId: publicKeyId(device.controllerKey),
			deviceId: wireDeviceId,
			issuedAt: Date.now(),
			expiresAt: Date.now() + 60_000,
			method,
			params,
		};
		const envelope = signMessage(request as never, device.controllerKey);
		const answer = await device.routes[0]!.exchange(envelope, AbortSignal.timeout(20_000));
		const response = verifyMessage(answer, device.deviceKey, {
			kind: "response",
			principalId: request.principalId,
			deviceId: wireDeviceId,
			requestId: request.requestId,
			now: Date.now(),
		});
		if (response.kind !== "response") throw new Error("Executor refused the introduction");
		if (!response.ok) throw new RemoteError(response.error.code, response.error.message);
		return normalizeResult(response.result, device);
	}
	let cloudRecords: RegisteredDevice[] | undefined;
	let cloudAt = 0;
	/** Reported through the trigger scheduler so a discovery failure is never a silent empty list. */
	async function cloudList(): Promise<RegisteredDevice[]> {
		if (!cloud) return [];
		// Refresh on every registry read: grants change as the owner narrows or revokes, and the
		// executor is the authority for them, so a cached snapshot would go stale unnoticed.
		if (!cloudRecords || Date.now() - cloudAt >= 0) {
			cloudRecords = await cloudDevices(
				{ ...cloud, allowInsecureLoopback: cloud.allowInsecureLoopback ?? allowInsecureLoopback },
				() => cardToken(cloud.credential),
				await controllerKey(pairingHome!),
				cloud.allowInsecureLoopback ?? allowInsecureLoopback,
				pins,
				refresh,
			);
			cloudAt = Date.now();
		}
		return cloudRecords;
	}
	return {
		async prepare() {
			await cloudList();
		},
		async registry() {
			const paired = await pairedRecords();
			const discovered = await cloudList();
			// A hand-written `devices[]` entry still wins for the same device: it may carry a direct route.
			const covered = new Set(paired.map((device) => device.deviceId));
			return [...paired, ...discovered.filter((device) => !covered.has(device.deviceId))];
		},
		async close() {
			await Promise.all([...cards.values()].map((c) => c.close()));
		},
	};

	async function pairedRecords(): Promise<RegisteredDevice[]> {
		if (!pairingHome) return [];
		// The directory may not exist yet on a host that has only cloud-discovered devices.
		const files = (await readdir(pairingHome).catch(() => [] as string[])).filter((name) =>
			/^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(name),
		);
		if (devices.some((d) => !files.includes(`device-${d.deviceId}.json`)))
			throw new Error("Configured device has no W1 pairing record");
		if (!files.length) return [];
		const controller = createPrivateKey(await privateFile(join(pairingHome, "controller-key.pem")));
		const principalId = publicKeyId(controller);
		return Promise.all(
			files.map(async (file) => {
				const deviceId = file.slice(7, -5);
				const configured = devices.find((d) => d.deviceId === deviceId);
				const peer: unknown = JSON.parse(await privateFile(join(pairingHome, file)));
				if (
					!peer ||
					typeof peer !== "object" ||
					!Object.hasOwn(peer, "publicKey") ||
					!Object.hasOwn(peer, "fingerprint") ||
					!Object.hasOwn(peer, "deviceId")
				)
					throw new Error("Invalid W1 device trust record");
				const record = peer as {
					deviceId: unknown;
					publicKey: unknown;
					fingerprint: unknown;
					direct?: { url: string; tlsFingerprint: string };
				};
				if (
					record.deviceId !== deviceId ||
					typeof record.publicKey !== "string" ||
					typeof record.fingerprint !== "string"
				)
					throw new Error("Wrong W1 paired device");
				const deviceKey = createPublicKey({
					key: Buffer.from(record.publicKey, "base64"),
					format: "der",
					type: "spki",
				});
				if (publicKeyId(deviceKey) !== record.fingerprint) throw new Error("W1 device fingerprint mismatch");
				const grants = configured?.grants ?? [];
				if (grants.some((g) => g.deviceId !== deviceId || g.principalId !== principalId))
					throw new Error("Configured grant does not belong to the paired device/principal");
				if (
					record.direct &&
					configured?.direct &&
					(record.direct.url !== configured.direct.url ||
						record.direct.tlsFingerprint !== configured.direct.tlsFingerprint)
				)
					throw new Error("Configured direct endpoint conflicts with W1 paired endpoint");
				const direct = configured?.direct ?? record.direct;
				const card = cards.get(deviceId);
				return {
					deviceId,
					name: configured?.name ?? deviceId,
					controllerKey: controller,
					deviceKey,
					grants,
					routes: [...(direct ? [directRoute(direct, allowInsecureLoopback)] : []), ...(card ? [card] : [])],
				};
			}),
		);
	}
}
