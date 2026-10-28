import { createHash, createPublicKey, type KeyObject, sign, verify } from "node:crypto";
import { Check } from "typebox/value";
import {
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
	if (packet.keyId !== publicKeyId(pairedKey)) throw new Error("UNAUTHORIZED");
	if (expected.kind === "request" && packet.keyId !== expected.principalId) throw new Error("UNAUTHORIZED");
	const bytes = payloadBytes(packet.payloadBase64);
	if (!verify(null, bytes, pairedKey, Buffer.from(packet.signatureBase64, "base64"))) throw new Error("UNAUTHORIZED");
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
	if (
		!Number.isSafeInteger(expected.now) ||
		message.issuedAt > expected.now ||
		message.expiresAt <= expected.now ||
		message.expiresAt <= message.issuedAt ||
		message.expiresAt - message.issuedAt > MAX_MESSAGE_AGE_MS
	)
		throw new Error("UNAUTHORIZED");
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
