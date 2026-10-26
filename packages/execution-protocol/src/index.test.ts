import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	CommandLookupSchema,
	commandDigest,
	commandKey,
	DeviceDescriptorSchema,
	decodeCommand,
	encodeCommand,
	publicKeyId,
	RelayFrameSchema,
	type RpcRequest,
	RpcRequestSchema,
	type RpcResponse,
	recoveredCommandState,
	type SubmitCommand,
	signMessage,
	verifyMessage,
} from "./index.js";

const controller = generateKeyPairSync("ed25519");
const executor = generateKeyPairSync("ed25519");
const foreign = generateKeyPairSync("ed25519");
const principalId = publicKeyId(controller.publicKey);
const deviceId = randomUUID();
const now = 1_700_000_000_000;
const request: RpcRequest = {
	protocol: "yonder.execution",
	version: 1,
	kind: "request",
	requestId: randomUUID(),
	principalId,
	deviceId,
	issuedAt: now,
	expiresAt: now + 30_000,
	method: "commands.status",
	params: { commandId: randomUUID() },
};
const expected = { principalId, deviceId, kind: "request" as const, now };
const command: SubmitCommand = {
	deviceId,
	principalId,
	commandId: randomUUID(),
	deviceSessionId: randomUUID(),
	leaseEpoch: 1,
	action: "filesystem.write",
	arguments: { path: "result.txt", text: "contract evidence" },
};

describe("paired endpoint signatures (isolated ephemeral keys)", () => {
	it("authenticates the same request forwarded through either route", () => {
		const envelope = signMessage(request, controller.privateKey);
		expect(verifyMessage(envelope, controller.publicKey, expected)).toEqual(request);
		const relay = { protocol: "yonder.execution.relay", version: 1, routeId: "test-route", envelope };
		expect(Check(RelayFrameSchema, relay)).toBe(true);
		expect(verifyMessage(JSON.parse(JSON.stringify(relay)).envelope, controller.publicKey, expected)).toEqual(request);
	});
	it("rejects a key chosen by the packet instead of the paired record", () => {
		const envelope = signMessage(request, foreign.privateKey);
		expect(() => verifyMessage(envelope, controller.publicKey, expected)).toThrow("UNAUTHORIZED");
		expect(() => verifyMessage(envelope, foreign.publicKey, expected)).toThrow("UNAUTHORIZED");
	});
	it("rejects signed bytes modified by a relay", () => {
		const envelope = signMessage(request, controller.privateKey);
		envelope.payloadBase64 = Buffer.from(JSON.stringify({ ...request, deviceId: randomUUID() })).toString("base64");
		expect(() => verifyMessage(envelope, controller.publicKey, expected)).toThrow("UNAUTHORIZED");
	});
	it.each([
		{ ...expected, deviceId: randomUUID() },
		{ ...expected, principalId: publicKeyId(foreign.publicKey) },
		{ ...expected, kind: "response" as const },
		{ ...expected, requestId: randomUUID() },
	])("rejects the wrong target, subject, direction or correlation", (binding) => {
		expect(() => verifyMessage(signMessage(request, controller.privateKey), controller.publicKey, binding)).toThrow();
	});
	it.each([
		{ issuedAt: now - 10_000, expiresAt: now },
		{ issuedAt: now + 1, expiresAt: now + 30_000 },
		{ issuedAt: now, expiresAt: now + 60_001 },
	])("rejects expired, future or overlong signed authorization windows", (times) => {
		expect(() =>
			verifyMessage(signMessage({ ...request, ...times }, controller.privateKey), controller.publicKey, expected),
		).toThrow("UNAUTHORIZED");
	});
	it("authenticates a response with the expected executor key and request binding", () => {
		const { method: _method, params: _params, ...header } = request;
		const response: RpcResponse = { ...header, kind: "response", ok: true, result: { state: "unknown" } };
		const envelope = signMessage(response, executor.privateKey);
		expect(
			verifyMessage(envelope, executor.publicKey, { ...expected, kind: "response", requestId: request.requestId }),
		).toEqual(response);
		expect(() =>
			verifyMessage(envelope, foreign.publicKey, { ...expected, kind: "response", requestId: request.requestId }),
		).toThrow("UNAUTHORIZED");
	});
});

describe("persistent command identity and recovery contract", () => {
	it("looks up a prior command without the original session or lease", () => {
		expect(Check(CommandLookupSchema, { commandId: command.commandId })).toBe(true);
		expect(Check(CommandLookupSchema, { commandId: command.commandId, deviceSessionId: command.deviceSessionId })).toBe(
			false,
		);
		expect(Check(RpcRequestSchema, request)).toBe(true);
	});
	it("keeps identity across routes and a new session, while binding different bytes to a conflicting digest", () => {
		const encoded = encodeCommand(command);
		expect(decodeCommand(encoded, expected)).toEqual(command);
		expect(() => decodeCommand(encoded, { ...expected, deviceId: randomUUID() })).toThrow("WRONG_TARGET");
		expect(() => decodeCommand(encoded, { ...expected, principalId: publicKeyId(foreign.publicKey) })).toThrow(
			"WRONG_TARGET",
		);
		expect(commandDigest(encoded)).toBe(
			commandDigest(JSON.parse(JSON.stringify({ direct: encoded, relay: encoded })).relay),
		);
		const changedSession = { ...command, deviceSessionId: randomUUID() };
		expect(commandKey(command)).toBe(commandKey(changedSession));
		expect(commandDigest(encoded)).not.toBe(commandDigest(encodeCommand(changedSession)));
		expect(commandDigest(encoded)).not.toBe(commandDigest(encodeCommand({ ...command, arguments: { path: "other" } })));
		expect(commandKey(command)).not.toBe(commandKey({ ...command, principalId: publicKeyId(foreign.publicKey) }));
		expect(commandKey(command)).not.toBe(commandKey({ ...command, deviceId: randomUUID() }));
	});
	it("does not silently accept non-canonical base64 or an injected command field", () => {
		expect(() => decodeCommand(`${encodeCommand(command)}\n`, expected)).toThrow("INVALID_REQUEST");
		const injected = Buffer.from(JSON.stringify({ ...command, createAgent: true })).toString("base64");
		expect(() => decodeCommand(injected, expected)).toThrow("INVALID_REQUEST");
	});
	it("recovers running as unknown and leaves recorded terminal states intact", () => {
		expect(recoveredCommandState("running")).toBe("unknown");
		for (const state of ["accepted", "succeeded", "failed", "cancelled", "unknown"] as const)
			expect(recoveredCommandState(state)).toBe(state);
	});
	it("rejects Agent/model, restore and authorization creation RPCs", () => {
		for (const method of ["agents.create", "sessions.open", "task_run", "grants.create", "device.checkpoint.restore"])
			expect(Check(RpcRequestSchema, { ...request, method, params: {} })).toBe(false);
		expect(Check(RpcRequestSchema, { ...request, version: 2 })).toBe(false);
		expect(Check(RpcRequestSchema, { ...request, capabilities: ["admin"] })).toBe(false);
	});
	it("requires the first release to declare checkpoint restore unsupported", () => {
		expect(DeviceDescriptorSchema.properties.checkpointRestore.const).toBe("unsupported");
	});
});
