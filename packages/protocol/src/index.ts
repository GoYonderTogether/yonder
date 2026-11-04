import { createHash, createHmac, createPublicKey, type KeyObject, sign, timingSafeEqual, verify } from "node:crypto";
import { Check } from "typebox/value";
import {
	type CloudAttestation,
	CloudAttestationSchema,
	type CommandIdentity,
	type CommandState,
	type RpcMessage,
	RpcMessageSchema,
	type SignedEnvelope,
	SignedEnvelopeSchema,
	type SubmitCommand,
	SubmitCommandSchema,
} from "./schema.js";

export * from "./schema.js";
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const MAX_MESSAGE_AGE_MS = 60_000;
export const MAX_ATTESTATION_AGE_MS = 300_000;

export function publicKeyId(key: KeyObject): string {
	const publicKey = key.type === "public" ? key : createPublicKey(key);
	if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("UNAUTHORIZED");
	return createHash("sha256")
		.update(publicKey.export({ format: "der", type: "spki" }))
		.digest("hex");
}

function payloadBytes(base64: string): Buffer {
	if (base64.length > Math.ceil(MAX_MESSAGE_BYTES / 3) * 4) throw new Error("INVALID_REQUEST");
	const bytes = Buffer.from(base64, "base64");
	if (!bytes.length || bytes.length > MAX_MESSAGE_BYTES || bytes.toString("base64") !== base64)
		throw new Error("INVALID_REQUEST");
	return bytes;
}

/** The caller supplies a paired key; a message cannot nominate its own trust root. */
export function signMessage(message: RpcMessage, privateKey: KeyObject): SignedEnvelope {
	if (!Check(RpcMessageSchema, message)) throw new Error("INVALID_REQUEST");
	const bytes = Buffer.from(JSON.stringify(message));
	if (bytes.length > MAX_MESSAGE_BYTES) throw new Error("INVALID_REQUEST");
	return {
		algorithm: "Ed25519",
		keyId: publicKeyId(privateKey),
		payloadBase64: bytes.toString("base64"),
		signatureBase64: sign(null, bytes, privateKey).toString("base64"),
	};
}

export function verifyMessage(
	envelope: unknown,
	pairedKey: KeyObject,
	expected: {
		principalId: string;
		deviceId: string;
		now: number;
	} & ({ kind: "request"; requestId?: string } | { kind: "response"; requestId: string }),
): RpcMessage {
	if (!Check(SignedEnvelopeSchema, envelope)) throw new Error("INVALID_REQUEST");
	const packet = envelope as SignedEnvelope;
	if (packet.keyId !== publicKeyId(pairedKey)) throw new Error("UNAUTHORIZED", { cause: { verification: "key-id" } });
	if (expected.kind === "request" && packet.keyId !== expected.principalId)
		throw new Error("UNAUTHORIZED", { cause: { verification: "principal" } });
	const bytes = payloadBytes(packet.payloadBase64);
	if (!verify(null, bytes, pairedKey, Buffer.from(packet.signatureBase64, "base64")))
		throw new Error("UNAUTHORIZED", { cause: { verification: "signature" } });
	const parsed: unknown = JSON.parse(bytes.toString("utf8"));
	if (!Check(RpcMessageSchema, parsed)) throw new Error("INVALID_REQUEST");
	const message = parsed as RpcMessage;
	if (
		message.deviceId !== expected.deviceId ||
		message.principalId !== expected.principalId ||
		message.kind !== expected.kind ||
		(expected.kind === "response" && expected.requestId === undefined) ||
		(expected.requestId !== undefined && message.requestId !== expected.requestId)
	)
		throw new Error("WRONG_TARGET");
	if (!Number.isSafeInteger(expected.now)) throw new Error("UNAUTHORIZED", { cause: { verification: "invalid-now" } });
	if (message.expiresAt <= message.issuedAt || message.expiresAt - message.issuedAt > MAX_MESSAGE_AGE_MS)
		throw new Error("UNAUTHORIZED", { cause: { verification: "invalid-window" } });
	if (message.expiresAt <= expected.now)
		throw new Error("UNAUTHORIZED", { cause: { verification: "expired", offsetMs: message.expiresAt - expected.now } });
	if (message.issuedAt > expected.now)
		throw new Error("UNAUTHORIZED", { cause: { verification: "future", offsetMs: message.issuedAt - expected.now } });
	return message;
}

export function encodeCommand(command: SubmitCommand): string {
	if (!Check(SubmitCommandSchema, command)) throw new Error("INVALID_REQUEST");
	const encoded = Buffer.from(JSON.stringify(command)).toString("base64");
	payloadBytes(encoded);
	return encoded;
}

function parseCommand(encoded: string): SubmitCommand {
	const command: unknown = JSON.parse(payloadBytes(encoded).toString("utf8"));
	if (!Check(SubmitCommandSchema, command)) throw new Error("INVALID_REQUEST");
	return command as SubmitCommand;
}

export function decodeCommand(
	encoded: string,
	expected: Pick<CommandIdentity, "deviceId" | "principalId">,
): SubmitCommand {
	const command = parseCommand(encoded);
	if (command.deviceId !== expected.deviceId || command.principalId !== expected.principalId)
		throw new Error("WRONG_TARGET");
	return command;
}

export function commandDigest(encoded: string): string {
	parseCommand(encoded);
	return createHash("sha256").update(payloadBytes(encoded)).digest("hex");
}

/** Persistent identity deliberately excludes transient session/route/request IDs. */
export function commandKey(identity: CommandIdentity): string {
	return JSON.stringify([identity.deviceId, identity.principalId, identity.commandId]);
}

export function recoveredCommandState(state: CommandState): CommandState {
	return state === "running" ? "unknown" : state;
}

/** Both sides derive the same key: the cloud stores the token hash, the executor holds the token. */
export function attestationKey(deviceToken: string): Buffer {
	if (!deviceToken || deviceToken.length > 128 || /\s/.test(deviceToken)) throw new Error("UNAUTHORIZED");
	return createHash("sha256").update(deviceToken).digest();
}

/** SHA-256 digests are also what the cloud stores instead of the token itself. */
export function attestationKeyFromHash(tokenSha256Hex: string): Buffer {
	if (!/^[a-f0-9]{64}$/.test(tokenSha256Hex)) throw new Error("INVALID_REQUEST");
	return Buffer.from(tokenSha256Hex, "hex");
}

export type AttestationInput = Omit<CloudAttestation, "mac">;

const AttestationInputSchema = {
	type: "object",
	additionalProperties: false,
	required: ["ownerId", "cloudDeviceId", "executorDeviceId", "action", "subject", "issuedAt", "expiresAt"],
	properties: {
		ownerId: { type: "string", minLength: 1, maxLength: 4096 },
		cloudDeviceId: { type: "string", minLength: 1, maxLength: 4096 },
		executorDeviceId: { type: "string", minLength: 1, maxLength: 4096 },
		action: { enum: ["introduce", "revoke", "policy"] },
		subject: { type: "string", minLength: 1, maxLength: 4096 },
		issuedAt: { type: "integer", minimum: 0 },
		expiresAt: { type: "integer", minimum: 0 },
	},
} as const;

function attestationBytes(input: AttestationInput): Buffer {
	return Buffer.from(
		JSON.stringify([
			input.ownerId,
			input.cloudDeviceId,
			input.executorDeviceId,
			input.action,
			input.subject,
			input.issuedAt,
			input.expiresAt,
		]),
	);
}

export function signAttestation(key: Buffer, input: AttestationInput): CloudAttestation {
	if (!Check(AttestationInputSchema, input)) throw new Error("INVALID_REQUEST");
	const mac = createHmac("sha256", key).update(attestationBytes(input)).digest("base64url");
	return { ...input, mac };
}

/** Verifies the cloud's claim; the caller still checks that the subject matches its own registration. */
export function verifyAttestation(value: unknown, key: Buffer, now = Date.now()): CloudAttestation {
	if (!Check(CloudAttestationSchema, value)) throw new Error("INVALID_REQUEST");
	const packet = value as CloudAttestation;
	const expected = createHmac("sha256", key).update(attestationBytes(packet)).digest();
	const actual = Buffer.from(packet.mac, "base64url");
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("UNAUTHORIZED");
	if (packet.expiresAt <= packet.issuedAt || packet.expiresAt - packet.issuedAt > MAX_ATTESTATION_AGE_MS)
		throw new Error("UNAUTHORIZED", { cause: { verification: "invalid-window" } });
	if (packet.expiresAt <= now) throw new Error("UNAUTHORIZED", { cause: { verification: "expired" } });
	if (packet.issuedAt > now) throw new Error("UNAUTHORIZED", { cause: { verification: "future" } });
	return packet;
}
