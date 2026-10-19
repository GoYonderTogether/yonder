import {
	type Attachment,
	definePlugin,
	type PluginAPI,
	parseRef,
	type Tool,
	type ToolContext,
	type TSchema,
} from "@yonder/sdk";
import { Check } from "typebox/value";
import { FeishuChannel } from "./channel.js";
import { uncertain } from "./client.js";
import { conversationContext } from "./conversation.js";
import { type Config, configSchema, object, required, string } from "./protocol.js";

const str = { type: "string", minLength: 1 };
export default definePlugin({
	setup(api: PluginAPI) {
		const instances = new Map<string, FeishuChannel>();
		api.contexts.register({
			id: "channel-feishu.conversation",
			placement: "turn",
			render(ctx) {
				const event = ctx.event;
				if (event?.type !== "message.in" || !event.conv) return;
				const ref = parseRef(event.conv);
				const channel = ref.kind === "conv" ? instances.get(ref.channel) : undefined;
				if (channel)
					return conversationContext(channel.client, event, ctx.signal ?? AbortSignal.timeout(30000), api.events);
			},
		});
		// Do not serialize later inbound observations behind network reaction requests.
		for (const type of ["message.in", "run.end", "channel.command.result"])
			api.events.on(type, (event) => {
				for (const channel of instances.values()) {
					const work = type === "message.in" ? channel.onInput(event) : channel.onEnd(event);
					void work.catch((error: unknown) =>
						api.log.warn("Feishu interaction failed", { instance: channel.id, error: channel.client.safe(error) }),
					);
				}
			});
		const register = (tool: Tool) =>
			api.tools.register({
				...tool,
				execute(input, ctx) {
					if (!Check(tool.parameters, input))
						return Promise.resolve({ text: "Invalid Feishu tool parameters", isError: true });
					return tool.execute(input, ctx);
				},
			});
		api.channels.register({
			type: "feishu",
			configSchema,
			create(id, value) {
				if (instances.has(id)) throw new Error(`Duplicate Feishu instance ${id}`);
				const channel = new FeishuChannel(id, value as Config, api);
				instances.set(id, channel);
				return channel;
			},
		});
		const resolve = (input: unknown) => {
			const args = object(input),
				id = required(args.instance, "instance"),
				channel = instances.get(id);
			if (!channel) throw new Error(`Unknown Feishu instance ${id}`);
			return { args, channel };
		};
		const targetOf = (args: Record<string, unknown>, channel: FeishuChannel) => {
			const target = required(args.to, "to"),
				ref = parseRef(target);
			if ((ref.kind !== "acct" && ref.kind !== "conv") || ref.channel !== channel.id)
				throw new Error("Target must be an acct/conv reference in the selected Feishu instance");
			return target;
		};
		const record = async (type: string, channel: FeishuChannel, target: string, id: string, ctx: ToolContext) => {
			await api.events.emit({
				type,
				...(ctx.event ? { parent: ctx.event.id } : {}),
				...(ctx.event?.from ? { from: ctx.event.from } : {}),
				...(target.startsWith("conv:") ? { conv: target } : {}),
				data: { instance: channel.id, to: target, messageId: id, session: ctx.session },
			});
		};
		register({
			name: "channel-feishu_status",
			description:
				"Read actual Feishu instance transport state and required permission guidance; does not connect or send. Connected is not full capability acceptance.",
			parameters: { type: "object", additionalProperties: false, properties: { instance: str } } as TSchema,
			capabilities: ["read"],
			async execute(input) {
				try {
					const args = object(input);
					const selected = string(args.instance);
					const channel = selected ? instances.get(selected) : undefined;
					if (selected && !channel) throw new Error("Unknown Feishu instance");
					return {
						text: JSON.stringify(channel ? channel.status() : [...instances.values()].map((value) => value.status())),
					};
				} catch (error) {
					return { text: error instanceof Error ? error.message : "Feishu status failed", isError: true };
				}
			},
		});
		register({
			name: "channel-feishu_history",
			description:
				"Read paginated Feishu chat/thread history and resolve message attachments. Non-admin callers can only read actual sources of this run; specifying another chat requires admin. Times are epoch milliseconds. Thread time filtering is local.",
			parameters: {
				type: "object",
				additionalProperties: false,
				required: ["instance"],
				properties: {
					instance: str,
					chat: str,
					thread: str,
					start: { type: "integer", minimum: 0 },
					end: { type: "integer", minimum: 0 },
					pageToken: str,
					pageSize: { type: "integer", minimum: 1, maximum: 50 },
				},
			} as TSchema,
			capabilities: ["read", "network"],
			async execute(input, ctx) {
				try {
					const { args, channel } = resolve(input);
					const sources = [...(ctx.events ?? []), ...(ctx.event ? [ctx.event] : [])].filter((event) =>
						event.conv?.startsWith(`conv:${channel.id}:`),
					);
					const chat = string(args.chat) || (sources[0]?.conv ? parseRef(sources[0].conv).id : "");
					if (!chat) throw new Error("A Feishu chat is required");
					if (
						!ctx.capabilities.includes("admin") &&
						!sources.some((event) => event.conv === `conv:${channel.id}:${chat}`)
					)
						throw new Error("Reading another Feishu source requires admin");
					const thread = string(args.thread);
					const result = await channel.history(
						{
							chat,
							...(thread ? { thread } : {}),
							...(typeof args.start === "number" ? { start: args.start } : {}),
							...(typeof args.end === "number" ? { end: args.end } : {}),
							...(string(args.pageToken) ? { pageToken: string(args.pageToken) } : {}),
							...(typeof args.pageSize === "number" ? { pageSize: args.pageSize } : {}),
						},
						ctx.signal,
					);
					return { text: JSON.stringify({ source: "Feishu", chat, ...result }) };
				} catch (error) {
					return { text: error instanceof Error ? error.message : "Feishu history failed", isError: true };
				}
			},
		});
		register({
			name: "channel-feishu_message",
			description:
				'Send ordinary text and local file: image/audio/video/file artifacts via Yonder message delivery. Set replyTo to a native message ID to explicitly quote it. For text/markdown modes, mention a known user with <at user_id="ou_ID">Name</at>; card Markdown uses <at id=ou_ID></at> via channel-feishu_card. Inspect instance renderMode before choosing markup; use native card JSON for mentions in other modes. After sending your answer here, finish with NO_REPLY to avoid a duplicate automatic reply. Uses selected instance render mode, chunk limits, replies and thread configuration. Audio requires Ogg/Opus, video MP4; no silent media downgrade.',
			parameters: {
				type: "object",
				additionalProperties: false,
				required: ["instance", "to", "text"],
				properties: {
					instance: str,
					to: str,
					text: { type: "string" },
					replyTo: str,
					attachments: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["kind", "mime", "uri"],
							properties: {
								kind: { enum: ["image", "audio", "video", "file"] },
								mime: str,
								uri: str,
								name: str,
								bytes: { type: "integer", minimum: 0 },
							},
						},
					},
				},
			} as TSchema,
			capabilities: ["message", "network", "read"],
			async execute(input, ctx) {
				try {
					ctx.signal.throwIfAborted();
					const { args, channel } = resolve(input);
					const to = targetOf(args, channel);
					const delivery = await api.messages.send(
						{
							to,
							via: channel.id,
							signal: ctx.signal,
							text: string(args.text),
							...(args.replyTo ? { replyTo: string(args.replyTo) } : {}),
							...(args.attachments ? { attachments: args.attachments as Attachment[] } : {}),
						},
						ctx,
					);
					return { text: JSON.stringify(delivery), ...(!delivery.ok ? { isError: true } : {}) };
				} catch (error) {
					return { text: error instanceof Error ? error.message : "Feishu send failed", isError: true };
				}
			},
		});
		register({
			name: "channel-feishu_card",
			description:
				"Send a native Feishu custom JSON card or a template card through a configured instance. Supply exactly card or templateId (or use instance template default). Records a plugin event and tool transcript; button callbacks are authenticated channel-feishu.card-action events, never automatic authorization.",
			parameters: {
				type: "object",
				additionalProperties: false,
				required: ["instance", "to"],
				properties: {
					instance: str,
					to: str,
					replyTo: str,
					card: { type: "object", additionalProperties: true },
					templateId: str,
					templateVersion: str,
					variables: { type: "object", additionalProperties: true },
				},
			} as TSchema,
			capabilities: ["message", "network"],
			async execute(input, ctx) {
				let channel: FeishuChannel | undefined;
				try {
					ctx.signal.throwIfAborted();
					const resolved = resolve(input);
					channel = resolved.channel;
					const args = resolved.args;
					const target = targetOf(args, channel);
					if (args.card && args.templateId) throw new Error("Choose custom card or templateId");
					const template = string(args.templateId) || channel.config.templateId;
					if (!args.card && !template) throw new Error("A custom card or template ID is required");
					const version = string(args.templateVersion) || channel.config.templateVersion;
					const card = args.card
						? object(args.card)
						: {
								type: "template",
								data: {
									template_id: template,
									...(version ? { template_version_name: version } : {}),
									template_variable: object(args.variables),
								},
							};
					if (Buffer.byteLength(JSON.stringify(card)) > 30000)
						throw new Error("Feishu custom/template card exceeds 30000 bytes");
					const id = await channel.rawSend(target, "interactive", card, string(args.replyTo) || undefined, ctx.signal);
					try {
						await record("channel-feishu.card-sent", channel, target, id, ctx);
					} catch {
						return {
							text: JSON.stringify({
								ok: false,
								id,
								error: "Card sent, but plugin event recording failed; do not resend",
							}),
							isError: true,
						};
					}
					return { text: JSON.stringify({ ok: true, id, source: "Feishu" }) };
				} catch (error) {
					return {
						text: JSON.stringify({
							ok: false,
							...(uncertain(error) ? { uncertain: true } : {}),
							error: channel
								? channel.client.safe(error)
								: error instanceof Error
									? error.message
									: "Feishu card failed",
						}),
						isError: true,
					};
				}
			},
		});
	},
});
