import type { MethodDef } from "@yonder/local-host/control/method-types";
import { MethodError } from "@yonder/local-host/control/method-types";
import type { ProgramToolInput } from "@yonder/local-host/kernel/program-tools";
import Type, { type TSchema } from "typebox";

const text = Type.String({ minLength: 1, maxLength: 256 });
const uuid = Type.String({ pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" });
const capabilityNames = ["read", "write", "exec", "network", "message", "cross-agent", "admin"] as const;
const capabilities = Type.Array(Type.Union(capabilityNames.map((value) => Type.Literal(value))));
const source = Type.Object(
	{
		instance: Type.Literal("card"),
		cloudBotId: uuid,
		ownerId: uuid,
		deviceId: uuid,
		platformAgentId: uuid,
		callerSession: text,
		invocationId: text,
		sourceMessageIds: Type.Array(uuid, { minItems: 1 }),
	},
	{ additionalProperties: false },
);
const ceiling = Type.Object(
	{
		capabilities,
		channelInstances: Type.Optional(Type.Array(text)),
		resources: Type.Optional(
			Type.Array(Type.Object({ deviceId: text, paths: Type.Array(text) }, { additionalProperties: false })),
		),
	},
	{ additionalProperties: false },
);
const catalogParams = Type.Object({ agent: text, source, ceiling }, { additionalProperties: false });
const callParams = Type.Object(
	{
		agent: text,
		source,
		ceiling,
		tool: text,
		arguments: Type.Record(Type.String(), Type.Unknown()),
	},
	{ additionalProperties: false },
);
const define = <P extends TSchema>(value: MethodDef<P>) => value as unknown as MethodDef;

function cardBridgeInstance(ctx: Parameters<MethodDef["handler"]>[1]) {
	const principal = ctx.principal;
	if (
		principal.kind !== "remote" ||
		principal.transport !== "gateway" ||
		!principal.scopes.includes("owner") ||
		!principal.id.startsWith("card:")
	)
		throw new MethodError("forbidden", "tools.catalog and tools.call require the trusted Card bridge");
	const instance = principal.id.slice("card:".length);
	if (!instance) throw new MethodError("forbidden", "Card bridge instance is missing");
	return instance;
}

function request(ctx: Parameters<MethodDef["handler"]>[1], input: ProgramToolInput, signal: AbortSignal) {
	return { facade: ctx.kernel.programTools, bridgeInstance: cardBridgeInstance(ctx), input, signal };
}

export const catalogMethods: MethodDef[] = [
	define({
		name: "tools.catalog",
		scope: "owner",
		params: catalogParams,
		since: 1,
		async handler(params, ctx, signal) {
			const call = request(ctx, params, signal);
			return call.facade.catalog(call.input, call.bridgeInstance, call.signal);
		},
	}),
	define({
		name: "tools.call",
		scope: "owner",
		params: callParams,
		since: 1,
		async handler(params, ctx, signal) {
			const call = request(ctx, params, signal);
			return call.facade.call(call.input, call.bridgeInstance, call.signal);
		},
	}),
];
