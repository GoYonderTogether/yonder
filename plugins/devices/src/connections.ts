import { createPrivateKey, createPublicKey } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { type Grant, GrantSchema, type PluginAPI, publicKeyId, type TSchema } from "@yonder/sdk";
import { Check } from "typebox/value";
import { CardRoute, directRoute } from "./routes.js";
import type { DeviceRegistry } from "./transport.js";

export interface ConnectionConfig {
	pairingHome?: string;
	allowInsecureLoopback?: boolean;
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

/** Reads the W1 ControllerPairing layout, without generating identity or editing its records. */
export function configuredRegistry(
	input: unknown,
	credentials: PluginAPI["credentials"],
): { registry: DeviceRegistry; close(): Promise<void> } {
	const config = input ?? {};
	if (!Check(configSchema, config)) throw new Error("Invalid devices plugin connection configuration");
	const { devices = [], pairingHome, allowInsecureLoopback = false } = config as ConnectionConfig;
	if ((devices.length && !pairingHome) || (pairingHome && !isAbsolute(pairingHome)))
		throw new Error("Configured devices require an explicit absolute W1 controller pairingHome");
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
	return {
		async registry() {
			if (!pairingHome) return [];
			const files = (await readdir(pairingHome)).filter((name) =>
				/^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(name),
			);
			if (devices.some((d) => !files.includes(`device-${d.deviceId}.json`)))
				throw new Error("Configured device has no W1 pairing record");
			if (!files.length) return [];
			const controllerKey = createPrivateKey(await privateFile(join(pairingHome, "controller-key.pem")));
			const principalId = publicKeyId(controllerKey);
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
						controllerKey,
						deviceKey,
						grants,
						routes: [...(direct ? [directRoute(direct, allowInsecureLoopback)] : []), ...(card ? [card] : [])],
					};
				}),
			);
		},
		async close() {
			await Promise.all([...cards.values()].map((c) => c.close()));
		},
	};
}
