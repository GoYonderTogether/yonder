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
export const CredentialSlotsSchema = Type.Record(Type.String({ pattern: "^.+$" }), text, {
	additionalProperties: false,
});
export const SessionModelsSchema = object({
	credentialSlots: Type.Optional(CredentialSlotsSchema),
	model: Type.Optional(Type.String({ pattern: "^[^/]+/.+$" })),
	thinking: Type.Optional(choice("off", "minimal", "low", "medium", "high", "xhigh", "max")),
	fallback: Type.Optional(
		object({
			models: Type.Array(Type.String({ pattern: "^[^/]+/.+$" }), { uniqueItems: true }),
			accounts: Type.Optional(
				Type.Record(Type.String({ pattern: "^.+$" }), Type.Array(text, { uniqueItems: true }), {
					additionalProperties: false,
				}),
			),
			accountModels: Type.Optional(
				Type.Record(
					Type.String({ pattern: "^.+$" }),
					Type.Record(Type.String({ pattern: "^[^/]+/.+$" }), Type.String({ pattern: "^[^/]+/.+$" }), {
						additionalProperties: false,
					}),
					{ additionalProperties: false },
				),
			),
			after: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
			/** Per slot: stop choosing the account once its official usage window is at or above this percent. */
			quotaStopPercent: Type.Optional(
				Type.Record(Type.String({ pattern: "^.+$" }), Type.Integer({ minimum: 1, maximum: 100 }), {
					additionalProperties: false,
				}),
			),
			hold: Type.Optional(Type.Integer({ minimum: 0, maximum: 86400 })),
			probe: Type.Optional(Type.Integer({ minimum: 15, maximum: 3600 })),
		}),
	),
});
const fields = {
	...SessionModelsSchema.properties,
	level: Type.Optional(choice("bypass", "standard", "readonly")),
	capabilities: Type.Optional(
		Type.Array(choice("read", "write", "exec", "network", "message", "cross-agent", "admin")),
	),
	channelInstances: Type.Optional(Type.Array(instanceId, { uniqueItems: true })),
	plugins: Type.Optional(strings),
	tools: Type.Optional(object({ offer: Type.Optional(strings), search: Type.Optional(strings) })),
	contexts: Type.Optional(strings),
	skills: Type.Optional(strings),
	prompt: Type.Optional(
		object({
			sections: Type.Optional(Type.Array(text, { uniqueItems: true })),
			overrides: Type.Optional(Type.Record(text, Type.String())),
		}),
	),
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
	busy: Type.Optional(choice("followup", "steer", "interrupt")),
	reply: Type.Optional(choice("auto", "none")),
	stream: Type.Optional(Type.Boolean()),
	deliver: Type.Optional(object({ to: text, via: Type.Optional(instanceId) })),
});

export const AgentSchema = object({
	schema: Type.Literal(1),
	id: text,
	name: text,
	avatarUrl: Type.Optional(text),
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
	locale: Type.Optional(text),
	timezone: Type.Optional(text),
	defaultModel: Type.Optional(text),
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
	notifications: Type.Optional(
		object({
			default: Type.Optional(choice("all", "mention", "mute")),
			conversations: Type.Optional(
				Type.Record(ref("conv"), choice("all", "mention", "mute"), { additionalProperties: false }),
			),
		}),
	),
	envs: Type.Optional(Type.Record(instanceId, providerConfig, { additionalProperties: false })),
	retry: Type.Optional(
		object({
			maxRetries: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
			baseDelayMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })),
			maxDelayMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483647 })),
		}),
	),
	/** Per-request model guards (G1 §6.3): no content within `firstTokenMs`, or the HTTP request past `totalMs`, fails it. */
	timeouts: Type.Optional(
		object({
			firstTokenMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
			totalMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 2147483647 })),
		}),
	),
	compaction: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	agents: Type.Optional(
		Type.Array(object({ id: text, workspace: text, env: Type.Optional(instanceId), archivedAt: Type.Optional(text) })),
	),
	gateway: Type.Optional(
		object({
			enabled: Type.Optional(Type.Boolean()),
			port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
			publicOrigins: Type.Optional(Type.Array(Type.String({ pattern: "^https?://[^/]+$" }), { uniqueItems: true })),
			basePath: Type.Optional(Type.String({ pattern: "^/([A-Za-z0-9._~-]+/)*$" })),
			/** sha256 of the long-lived remote access token; the token itself is never stored. */
			accessTokenHash: Type.Optional(Type.String({ pattern: "^sha256:[0-9a-f]{64}$" })),
			/** Trust X-Forwarded-For (first hop) from a loopback reverse proxy for per-client login throttling. */
			trustProxy: Type.Optional(Type.Boolean()),
			/** Grant the `owner` scope (talk to resident Bots) to remote access-token logins. Off by default. */
			remoteOwner: Type.Optional(Type.Boolean()),
		}),
	),
	imports: Type.Optional(object({ piSessionsDir: Type.Optional(text) })),
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
