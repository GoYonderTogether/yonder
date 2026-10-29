import Type, { type Static, type TLiteral, type TSchema } from "typebox";
import { outboundSchema, socialSchema } from "./social-schema.js";

const object = <T extends Record<string, TSchema>>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });
const text = Type.String({ minLength: 1 });
const strings = Type.Array(text);
const choice = <const T extends [string, ...string[]]>(...values: T) =>
	Type.Union(values.map((value) => Type.Literal(value)) as [TLiteral<T[number]>, ...TLiteral<T[number]>[]]);
const ref = (prefix: string) => Type.String({ pattern: `^${prefix}:.+` });
const instanceId = Type.String({ pattern: "^[a-z0-9-]+$" });
/** token 数：整数，或 `500K` / `2M` 这样的十进制单位（1M = 1,000,000）。 */
const tokenAmount = Type.Union([Type.Integer({ minimum: 0 }), Type.String({ pattern: "^[0-9]+(?:\\.[0-9]+)?[KM]$" })]);
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
			order: Type.Optional(choice("accounts-first", "models-first")),
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
	cheap: Type.Optional(Type.String({ pattern: "^[^/]+/.+$" })),
	simple: Type.Optional(Type.String({ pattern: "^[^/]+/.+$" })),
	level: Type.Optional(choice("bypass", "standard", "readonly")),
	capabilities: Type.Optional(
		Type.Array(choice("read", "write", "exec", "network", "message", "cross-agent", "admin")),
	),
	channelInstances: Type.Optional(Type.Array(instanceId, { uniqueItems: true })),
	plugins: Type.Optional(strings),
	tools: Type.Optional(
		object({
			offer: Type.Optional(strings),
			search: Type.Optional(strings),
			/** 懒加载分组（X7）：属于这些分组的工具默认不进常驻工具表；空数组表示全部常驻。默认为代码智能。 */
			lazyGroups: Type.Optional(strings),
		}),
	),
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
			stuckMinutes: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
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
	version: Type.Optional(Type.Literal(1)),
	id: text,
	name: text,
	avatarUrl: Type.Optional(text),
	work: Type.Optional(text),
	owner: ref("person"),
	defaultProfile: text,
	defaults: Type.Optional(ProfileSchema),
	profiles: Type.Record(text, ProfileSchema),
	bindings: Type.Array(BindingSchema),
	social: Type.Optional(socialSchema),
});
export const PresetSchema = object({
	schema: Type.Literal(1),
	version: Type.Optional(Type.Literal(1)),
	description: text,
	...fields,
});
export const YonderSchema = object({
	schema: Type.Literal(1),
	version: Type.Optional(Type.Literal(1)),
	locale: Type.Optional(text),
	timezone: Type.Optional(text),
	defaultModel: Type.Optional(text),
	plugins: Type.Optional(Type.Array(object({ use: text, config: Type.Optional(Type.Unknown()) }))),
	channels: Type.Optional(Type.Record(instanceId, providerConfig, { additionalProperties: false })),
	credentials: Type.Optional(text),
	models: Type.Optional(
		object({
			providers: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			/** 兜底链顺序：条目是 provider，或 provider/model（缺省见 parseYonderConfig）。 */
			chain: Type.Optional(Type.Array(Type.String({ pattern: "^[^/]+(?:/.+)?$" }), { uniqueItems: true })),
			/** 按量付费模型的价格上限（元/百万 token），输入与输出单价都不得超过。 */
			priceCapPerMTokenYuan: Type.Optional(Type.Number({ minimum: 0 })),
		}),
	),
	budget: Type.Optional(
		object({
			/** 0 表示不限。 */
			tokens: Type.Optional(Type.Integer({ minimum: 0 })),
			maxMinutes: Type.Optional(Type.Number({ minimum: 0 })),
			maxWakeups: Type.Optional(Type.Integer({ minimum: 0 })),
			/** 超预算时的处理：record 只记录并显示，stop 中断（M5 首版为 record）。 */
			overBudget: Type.Optional(choice("record", "stop")),
		}),
	),
	/** 外人（访客与登录的非主人）的额度与能力上限（Q1-Q3、C1）。 */
	outsiders: Type.Optional(
		object({
			ownerShareDailyTokens: Type.Optional(tokenAmount),
			perPersonDailyTokens: Type.Optional(tokenAmount),
			requireLoginForQuota: Type.Optional(Type.Boolean()),
			guestMaxRounds: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
			guestPerQrDailyTokens: Type.Optional(tokenAmount),
			guestPerSourceDailyRounds: Type.Optional(Type.Integer({ minimum: 0 })),
			capabilities: Type.Optional(Type.Array(choice("chat", "web_search", "public_docs"))),
			/** 主人标记为公开的目录或条目；外人只能读这些（IMP-26）。 */
			publicDocs: Type.Optional(Type.Array(text)),
		}),
	),
	defaults: Type.Optional(
		object({
			/** 未配白名单的渠道：open 放行走外人额度，closed 只允许主人与白名单（C1）。 */
			channelPolicy: Type.Optional(choice("open", "closed")),
		}),
	),
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
			default: Type.Optional(choice("all", "mention", "mentions", "mute")),
			outbound: Type.Optional(outboundSchema),
			conversations: Type.Optional(
				Type.Record(Type.String({ pattern: "^.+$" }), choice("all", "mention", "mentions", "mute"), {
					additionalProperties: false,
				}),
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
			/** Grant the `admin` scope (config.update, social.update, management) to remote access-token logins. Off by default. */
			remoteAdmin: Type.Optional(Type.Boolean()),
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
