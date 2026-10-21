import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Attachment, definePlugin, type Tool, type ToolContext } from "@yonder/sdk";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { type Config, IlinkChannel, privateWrite } from "./channel.js";

const str = Type.String({ minLength: 1 });
const person = Type.String({ pattern: "^person:[^\\s:]+$" });
export const configSchema = Type.Object(
	{
		person: Type.Optional(Type.Union([person, Type.Null()])),
		allowedUsers: Type.Optional(Type.Array(str)),
		credential: Type.Optional(str),
		peerId: Type.Optional(str),
		botId: Type.Optional(str),
		streaming: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
const pluginSchema = Type.Object({ owner: person }, { additionalProperties: false });
export default definePlugin({
	configSchema: pluginSchema,
	setup(api) {
		const config = (api.config ?? {}) as Static<typeof pluginSchema>;
		const instances = new Map<string, IlinkChannel>();
		let first: string | undefined;
		let primary: Promise<string> | undefined;
		function primaryId(): Promise<string> {
			primary ??= (async () => {
				await mkdir(api.paths.data, { recursive: true, mode: 0o700 });
				const file = join(api.paths.data, "primary.json");
				try {
					const value: unknown = JSON.parse(await readFile(file, "utf8"));
					if (typeof value !== "string" || !/^[a-z0-9-]+$/.test(value)) throw new Error();
					return value;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT")
						throw new Error("Invalid iLink primary instance state");
					if (!first) throw new Error("No iLink instance configured");
					await privateWrite(file, first);
					return first;
				}
			})();
			return primary;
		}
		api.channels.register({
			type: "wechat-ilink",
			configSchema,
			create(id, value) {
				if (instances.has(id)) throw new Error("Duplicate iLink instance");
				first ??= id;
				const channel = new IlinkChannel(id, value as Config, api, async () =>
					(await primaryId()) === id ? config.owner : undefined,
				);
				instances.set(id, channel);
				return channel;
			},
		});
		function channel(instance: string): IlinkChannel {
			const result = instances.get(instance);
			if (!result) throw new Error("Unknown iLink instance");
			return result;
		}
		function tool(value: Tool): void {
			api.tools.register({
				...value,
				async execute(input, ctx) {
					try {
						ctx.signal.throwIfAborted();
						if (!Check(value.parameters, input)) throw new Error("Invalid iLink tool parameters");
						return await value.execute(input, ctx);
					} catch (error) {
						return { isError: true, text: error instanceof Error ? error.message : "iLink operation failed" };
					}
				},
			});
		}
		tool({
			name: "channel-wechat-ilink_status",
			description:
				"Read cached iLink pairing, per-instance identity and context readiness. No credentials, network requests, or sending.",
			capabilities: ["read"],
			parameters: Type.Object({ instance: Type.Optional(str) }, { additionalProperties: false }),
			async execute(input) {
				const { instance } = input as { instance?: string };
				return {
					text: JSON.stringify(
						instance
							? await channel(instance).status()
							: await Promise.all([...instances.values()].map((c) => c.status())),
					),
				};
			},
		});
		tool({
			name: "channel-wechat-ilink_login",
			description:
				"Admin QR pairing: start returns a QR URL for the human to scan; poll checks confirmation. First configured instance defaults to plugin owner; later instances use their own configured person or remain unlinked. Never returns bot tokens. Existing connected accounts cannot be silently replaced.",
			capabilities: ["admin", "network"],
			parameters: Type.Object(
				{
					instance: str,
					action: Type.Union([Type.Literal("start"), Type.Literal("poll")]),
					verifyCode: Type.Optional(Type.String({ pattern: "^\\d{1,12}$" })),
				},
				{ additionalProperties: false },
			),
			async execute(input, ctx) {
				const args = input as { instance: string; action: "start" | "poll"; verifyCode?: string };
				return { text: JSON.stringify(await channel(args.instance).login(args.action, ctx.signal, args.verifyCode)) };
			},
		});
		tool({
			name: "channel-wechat-ilink_message",
			description:
				"Send text and optional image/audio/video/file through Yonder delivery to an explicit acct:/conv: reference in this iLink instance. Requires recipient context from prior inbound contact; cannot use another peer context. Audio is sent as a file. After using this for the answer, finish with NO_REPLY to prevent duplicate automatic reply. Unknown outcome must not be resent.",
			capabilities: ["read", "message", "network"],
			parameters: Type.Object(
				{
					instance: str,
					to: Type.String({ pattern: "^(acct|conv):[^:]+:.+$" }),
					text: Type.String(),
					replyTo: Type.Optional(str),
					attachments: Type.Optional(
						Type.Array(
							Type.Object(
								{
									kind: Type.Union(["image", "audio", "video", "file"].map((value) => Type.Literal(value))),
									mime: str,
									uri: Type.String({ pattern: "^file:///" }),
									name: Type.Optional(str),
									bytes: Type.Optional(Type.Integer({ minimum: 0 })),
								},
								{ additionalProperties: false },
							),
						),
					),
				},
				{ additionalProperties: false },
			),
			async execute(input, ctx: ToolContext) {
				const args = input as {
					instance: string;
					to: string;
					text: string;
					replyTo?: string;
					attachments?: Attachment[];
				};
				const c = channel(args.instance);
				if (!args.to.startsWith(`acct:${c.id}:`) && !args.to.startsWith(`conv:${c.id}:`))
					throw new Error("Target belongs to another iLink instance");
				const delivery = await api.messages.send(
					{
						to: args.to,
						via: c.id,
						text: args.text,
						signal: ctx.signal,
						...(args.replyTo ? { replyTo: args.replyTo } : {}),
						...(args.attachments ? { attachments: args.attachments } : {}),
					},
					ctx,
				);
				return { text: JSON.stringify(delivery), ...(!delivery.ok ? { isError: true } : {}) };
			},
		});
	},
});
