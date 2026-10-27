import { type Static, type TSchema, Type } from "typebox";

const object = <P extends Record<string, TSchema>>(properties: P) =>
	Type.Object(properties, { additionalProperties: false });
const id = Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" });
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
const text = Type.String({ minLength: 1, maxLength: 4096 });
const time = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const base64 = Type.String({
	minLength: 4,
	maxLength: 1_398_104,
	pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
});
const capabilities = Type.Array(
	Type.Union([
		Type.Literal("read"),
		Type.Literal("write"),
		Type.Literal("exec"),
		Type.Literal("network"),
		Type.Literal("message"),
	]),
	{ uniqueItems: true, maxItems: 5 },
);
const identity = { deviceId: id, principalId: hash, commandId: id };

export const OriginSchema = object({ agentId: Type.Union([text, Type.Null()]), profileId: text, modelSessionId: text });
export const GrantSchema = object({
	grantId: id,
	deviceId: id,
	principalId: hash,
	revision: integer,
	capabilities,
	targetIds: Type.Array(text),
	actions: Type.Array(text),
	readRoots: Type.Array(text),
	writeRoots: Type.Array(text),
	issuedAt: time,
	expiresAt: time,
	revokedAt: Type.Union([time, Type.Null()]),
});
export const DeviceSessionSchema = object({
	deviceSessionId: id,
	deviceId: id,
	principalId: hash,
	targetId: text,
	grantId: id,
	grantRevision: integer,
	leaseEpoch: integer,
	capabilities,
	origin: OriginSchema,
	expiresAt: time,
});
export const SubmitCommandSchema = object({
	...identity,
	deviceSessionId: id,
	leaseEpoch: integer,
	action: text,
	arguments: Type.Record(Type.String(), Type.Unknown()),
});
export const CommandLookupSchema = object({ commandId: id });
export const CommandStateSchema = Type.Enum([
	"accepted",
	"running",
	"succeeded",
	"failed",
	"cancelled",
	"unknown",
] as const);
export const ExecutionErrorSchema = object({
	code: Type.Enum([
		"INVALID_REQUEST",
		"UNSUPPORTED_VERSION",
		"UNPAIRED",
		"UNAUTHORIZED",
		"WRONG_TARGET",
		"GRANT_EXPIRED",
		"GRANT_REVOKED",
		"LEASE_EXPIRED",
		"LEASE_STALE",
		"COMMAND_CONFLICT",
		"COMMAND_NOT_FOUND",
		"BUSY",
		"UNSUPPORTED_OPERATION",
		"OUTCOME_UNKNOWN",
		"INTERNAL_ERROR",
	] as const),
	message: text,
});
export const CommandReceiptSchema = object({
	...identity,
	deviceSessionId: id,
	payloadSha256: hash,
	state: CommandStateSchema,
	acceptedAt: time,
	updatedAt: time,
	result: Type.Optional(Type.Unknown()),
	error: Type.Optional(ExecutionErrorSchema),
});
export const AppInventorySchema = object({
	deviceId: id,
	targetId: text,
	observedAt: Type.Union([time, Type.Null()]),
	status: Type.Enum(["available", "unsupported", "denied", "error"] as const),
	complete: Type.Boolean(),
	items: Type.Array(object({ id: text, name: text, version: Type.Optional(text) })),
	reason: Type.Optional(text),
});
export const DeviceDescriptorSchema = object({
	schemaVersion: Type.Literal(1),
	deviceId: id,
	role: Type.Union([Type.Literal("full"), Type.Literal("execution-only")]),
	os: object({ name: text, version: text }),
	hostArch: text,
	processArch: text,
	runtimeVersion: text,
	targets: Type.Array(object({ id: text, name: text })),
	capabilities: Type.Array(
		object({
			id: text,
			version: text,
			scope: text,
			state: Type.Union([Type.Literal("available"), Type.Literal("unsupported"), Type.Literal("denied")]),
		}),
	),
	resources: object({
		observedAt: Type.Union([time, Type.Null()]),
		cpuCount: Type.Optional(integer),
		memoryTotalBytes: Type.Optional(integer),
		memoryAvailableBytes: Type.Optional(integer),
		diskAvailableBytes: Type.Optional(integer),
		reason: Type.Optional(text),
	}),
	apps: object({
		observedAt: Type.Union([time, Type.Null()]),
		status: AppInventorySchema.properties.status,
		complete: Type.Boolean(),
	}),
	lastSeenAt: Type.Union([time, Type.Null()]),
	health: Type.Enum(["ready", "busy", "offline", "degraded", "unpaired"] as const),
	routes: Type.Array(
		object({
			kind: Type.Union([Type.Literal("direct"), Type.Literal("card")]),
			reachable: Type.Boolean(),
			observedAt: time,
		}),
	),
	checkpointRestore: Type.Literal("unsupported"),
});
export const UiSnapshotSchema = object({
	deviceId: id,
	deviceSessionId: id,
	targetId: text,
	observedAt: time,
	status: Type.Union([Type.Literal("available"), Type.Literal("unsupported"), Type.Literal("denied")]),
	tree: Type.Optional(Type.Unknown()),
	screenshot: Type.Optional(
		object({ mime: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]), dataBase64: base64 }),
	),
	reason: Type.Optional(text),
});

const requestHeader = {
	protocol: Type.Literal("yonder.execution"),
	version: Type.Literal(1),
	kind: Type.Literal("request"),
	requestId: id,
	principalId: hash,
	deviceId: id,
	issuedAt: integer,
	expiresAt: integer,
};
const request = <M extends string, P extends TSchema>(method: M, params: P) =>
	object({ ...requestHeader, method: Type.Literal(method), params });
export const RpcRequestSchema = Type.Union([
	request("device.describe", object({})),
	request("device.apps.list", object({ targetId: text })),
	request("device.ui.snapshot", object({ deviceSessionId: id })),
	request("device.sessions.open", object({ targetId: text, grantId: id, capabilities, origin: OriginSchema })),
	request("device.sessions.close", object({ deviceSessionId: id })),
	request("commands.submit", object({ commandBase64: base64 })),
	request("commands.status", CommandLookupSchema),
	request("commands.cancel", CommandLookupSchema),
	request("grants.revoke", object({ grantId: id })),
]);
const responseHeader = { ...requestHeader, kind: Type.Literal("response") };
export const RpcResponseSchema = Type.Union([
	object({ ...responseHeader, ok: Type.Literal(true), result: Type.Unknown() }),
	object({ ...responseHeader, ok: Type.Literal(false), error: ExecutionErrorSchema }),
]);
export const RpcMessageSchema = Type.Union([RpcRequestSchema, RpcResponseSchema]);
export const SignedEnvelopeSchema = object({
	algorithm: Type.Literal("Ed25519"),
	keyId: hash,
	payloadBase64: base64,
	signatureBase64: Type.String({ minLength: 88, maxLength: 88, pattern: "^[A-Za-z0-9+/]{86}==$" }),
});
export const RelayFrameSchema = object({
	protocol: Type.Literal("yonder.execution.relay"),
	version: Type.Literal(1),
	routeId: text,
	envelope: SignedEnvelopeSchema,
});

export type ExecutionCapability = Static<typeof GrantSchema>["capabilities"][number];
export type Origin = Static<typeof OriginSchema>;
export type Grant = Static<typeof GrantSchema>;
export type DeviceSession = Static<typeof DeviceSessionSchema>;
export type SubmitCommand = Static<typeof SubmitCommandSchema>;
export type CommandIdentity = Pick<SubmitCommand, "deviceId" | "principalId" | "commandId">;
export type CommandLookup = Static<typeof CommandLookupSchema>;
export type CommandState = Static<typeof CommandStateSchema>;
export type CommandReceipt = Static<typeof CommandReceiptSchema>;
export type ExecutionError = Static<typeof ExecutionErrorSchema>;
export type DeviceDescriptor = Static<typeof DeviceDescriptorSchema>;
export type AppInventory = Static<typeof AppInventorySchema>;
export type UiSnapshot = Static<typeof UiSnapshotSchema>;
export type RpcRequest = Static<typeof RpcRequestSchema>;
export type RpcResponse = Static<typeof RpcResponseSchema>;
export type RpcMessage = Static<typeof RpcMessageSchema>;
export type SignedEnvelope = Static<typeof SignedEnvelopeSchema>;
export type RelayFrame = Static<typeof RelayFrameSchema>;
