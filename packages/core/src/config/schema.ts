import Type, { type Static, type TLiteral, type TSchema } from "typebox";

const object = <T extends Record<string, TSchema>>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });
const text = Type.String({ minLength: 1 });
const strings = Type.Array(text);
const choice = <const T extends [string, ...string[]]>(...values: T) =>
	Type.Union(values.map((value) => Type.Literal(value)) as [TLiteral<T[number]>, ...TLiteral<T[number]>[]]);
const ref = (prefix: string) => Type.String({ pattern: `^${prefix}:.+` });
const instanceId = Type.String({ pattern: "^[a-z0-9-]+$" });
const providerConfig = Type.Object({ type: text }, { additionalProperties: true });
const fields = {
	model: Type.Optional(Type.String({ pattern: "^[^/]+/.+$" })),
	thinking: Type.Optional(choice("off", "minimal", "low", "medium", "high", "xhigh", "max")),
	level: Type.Optional(choice("bypass", "standard", "readonly")),
	capabilities: Type.Optional(
		Type.Array(choice("read", "write", "exec", "network", "message", "cross-agent", "admin")),
	),
	plugins: Type.Optional(strings),
	tools: Type.Optional(object({ offer: Type.Optional(strings), search: Type.Optional(strings) })),
	contexts: Type.Optional(strings),
	skills: Type.Optional(strings),
	instructions: Type.Optional(Type.String()),
	env: Type.Optional(instanceId),
	limits: Type.Optional(
		object({
			maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
			maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
			maxMinutes: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
			repeatBlock: Type.Optional(Type.Integer({ minimum: 1 })),
			repeatStop: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
	),
};

export const ProfileSchema = object(fields);
export const BindingSchema = object({
	id: text,
	match: object({
		type: Type.Optional(text),
		channel: Type.Optional(Type.Union([instanceId, Type.Array(instanceId)])),
		kind: Type.Optional(Type.Union([text, strings])),
		from: Type.Optional(
			Type.Union([
				choice("owner", "known", "stranger"),
				ref("person"),
				ref("acct"),
				Type.Array(Type.Union([choice("owner", "known", "stranger"), ref("person"), ref("acct")])),
			]),
		),
		conv: Type.Optional(Type.Union([ref("conv"), Type.Array(ref("conv"))])),
	}),
	session: Type.Union([
		choice("main", "ephemeral"),
		object({ mode: Type.Literal("persistent"), per: choice("conv", "from", "person") }),
	]),
	profile: Type.Optional(text),
	wake: Type.Optional(choice("run", "write", "mention")),
	busy: Type.Optional(choice("followup", "steer")),
	reply: Type.Optional(choice("auto", "none")),
	stream: Type.Optional(Type.Boolean()),
	deliver: Type.Optional(object({ to: text, via: Type.Optional(instanceId) })),
});

export const AgentSchema = object({
	schema: Type.Literal(1),
	id: text,
	name: text,
	work: Type.Optional(text),
	owner: ref("person"),
	defaultProfile: text,
	defaults: Type.Optional(ProfileSchema),
	profiles: Type.Record(text, ProfileSchema),
	bindings: Type.Array(BindingSchema),
});
export const PresetSchema = object({ schema: Type.Literal(1), description: text, ...fields });
export const YonderSchema = object({
	schema: Type.Literal(1),
	plugins: Type.Optional(Type.Array(object({ use: text, config: Type.Optional(Type.Unknown()) }))),
	channels: Type.Optional(Type.Record(instanceId, providerConfig, { additionalProperties: false })),
	credentials: Type.Optional(text),
	models: Type.Optional(object({ providers: Type.Optional(Type.Record(Type.String(), Type.Unknown())) })),
	services: Type.Optional(
		Type.Array(
			object({
				id: text,
				protocol: text,
				baseUrl: text,
				credential: Type.Optional(text),
				capabilities: Type.Record(text, object({ models: strings, voices: Type.Optional(strings) })),
			}),
		),
	),
	envs: Type.Optional(Type.Record(instanceId, providerConfig, { additionalProperties: false })),
	compaction: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	agents: Type.Optional(
		Type.Array(object({ id: text, workspace: text, env: Type.Optional(instanceId), archivedAt: Type.Optional(text) })),
	),
	identity: Type.Optional(
		object({
			persons: Type.Array(
				object({
					id: text,
					name: text,
					accounts: Type.Optional(Type.Array(ref("acct"))),
					note: Type.Optional(Type.String()),
				}),
			),
		}),
	),
});

export type Binding = Static<typeof BindingSchema>;
export type AgentConfig = Static<typeof AgentSchema> & { archivedAt?: string };
export type YonderConfig = Static<typeof YonderSchema>;
