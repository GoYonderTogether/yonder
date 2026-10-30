import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment, Tool, ToolContext, YEvent } from "@yonder/sdk";
import { Type } from "typebox";
import { workspaceFiles } from "../runtime/env.js";
import type { Store } from "../store/index.js";
import { coreToolCapabilities } from "./catalog.js";
import { requireCapability, tool } from "./helpers.js";
import { schema, text } from "./tool-schema.js";

export function sourceConversation(ctx: Pick<ToolContext, "event" | "events">): string {
	const convs = [...new Set((ctx.events ?? (ctx.event ? [ctx.event] : [])).map((e) => e.conv).filter(Boolean))];
	if (convs.length !== 1 || !convs[0]?.startsWith("conv:")) throw new Error("当前运行没有唯一来源会话。");
	return convs[0];
}
const visible = (event: YEvent) =>
	event.type === "message.in" ||
	(event.type === "message.out" && (event.data as { delivery?: { ok?: boolean } }).delivery?.ok === true);

export async function conversationMessage(store: Store, event: YEvent, agent?: string | null) {
	const data = event.data as {
		text?: string;
		name?: string;
		msgId?: string;
		createdAt?: string;
		replyTo?: string;
		mentions?: string[];
		attachments?: Attachment[];
		delivery?: { id?: string };
		senderIsBot?: boolean;
		quote?: unknown;
	};
	const account = event.from?.startsWith("acct:") ? await store.identity().account(event.from) : undefined;
	const relation = agent && account ? await store.identity().relation(agent, event.from ?? account.ref) : undefined;
	return {
		id: event.id,
		nativeId: data.msgId ?? data.delivery?.id,
		direction: event.type === "message.in" ? "in" : "out",
		from: event.from,
		name: data.name ?? account?.name,
		relation,
		person: account?.person,
		self: !!agent && event.from === `agent:${agent}`,
		senderIsBot: data.senderIsBot,
		time: event.ts,
		sent: data.createdAt,
		text: data.text ?? "",
		replyTo: data.replyTo,
		quote: data.quote,
		mentions: data.mentions ?? [],
		attachments: (data.attachments ?? []).map((a, index) => ({
			index,
			kind: a.kind,
			mime: a.mime,
			name: a.name,
			bytes: a.bytes,
			message: event.id,
		})),
	};
}

// ponytail: scan the current conversation once per group run; add an event-derived view only if large histories make this measurable.
export async function conversationMembers(store: Store, conv: string, agent?: string | null, signal?: AbortSignal) {
	const members = new Map<
		string,
		{
			ref: string;
			name?: string | undefined;
			relation?: string | undefined;
			person?: string | undefined;
			self: boolean;
		}
	>();
	const recentSent: Awaited<ReturnType<typeof conversationMessage>>[] = [];
	let after: string | undefined;
	do {
		signal?.throwIfAborted();
		const page = await store.events.query({ conv, limit: 1000, ...(after ? { after } : {}) });
		for (const event of page.events) {
			if (!visible(event) || !event.from) continue;
			const message = await conversationMessage(store, event, agent);
			if (event.type === "message.out") {
				recentSent.push(message);
				if (recentSent.length > 10) recentSent.shift();
			}
			members.set(event.from, {
				ref: event.from,
				name: message.name,
				relation: message.relation,
				person: message.person,
				self: message.self,
			});
		}
		after = page.next;
	} while (after);
	if (agent && !members.has(`agent:${agent}`)) members.set(`agent:${agent}`, { ref: `agent:${agent}`, self: true });
	return {
		conv,
		scope: "observed-history",
		members: [...members.values()],
		recentSentScope: "last-10-confirmed-sends",
		recentSent,
	};
}

export function createConversationTools(store: Store, home: string): Tool[] {
	const definitions: Array<Omit<Tool, "capabilities">> = [
		{
			name: "conversation_read",
			description:
				"Read recorded messages of this run's current conversation only. Find prior messages or attachments by literal body/filename query, sender, time or internal event id. Includes confirmed sent messages; never other chats. after is the returned scan cursor, even when no messages matched. Attachment indices are zero-based.",
			parameters: schema({
				id: Type.Optional(text()),
				from: Type.Optional(text()),
				since: Type.Optional(text()),
				until: Type.Optional(text()),
				query: Type.Optional(text()),
				after: Type.Optional(text()),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
			}),
			async execute(args, ctx) {
				requireCapability(ctx, "read");
				const conv = sourceConversation(ctx);
				const a = args as {
					id?: string;
					from?: string;
					since?: string;
					until?: string;
					query?: string;
					after?: string;
					limit?: number;
				};
				const { query, limit = 50, ...filters } = a;
				const page = await store.events.query({ ...filters, conv, limit });
				const matches = page.events.filter(
					(e) =>
						visible(e) &&
						(!query ||
							[
								(e.data as { text?: string }).text ?? "",
								...((e.data as { attachments?: Attachment[] }).attachments ?? []).map((a) => a.name ?? ""),
							]
								.join("\n")
								.toLocaleLowerCase()
								.includes(query.toLocaleLowerCase())),
				);
				return {
					text: JSON.stringify({
						conv,
						scope: "recorded-history",
						messages: await Promise.all(matches.map((e) => conversationMessage(store, e, ctx.agent))),
						next: page.next,
						scanned: page.events.length,
					}),
				};
			},
		},
		{
			name: "conversation_members",
			description:
				"List all observed participants in this run's conversation, including this Agent. Names and relations come from records. This is not the platform's full membership list.",
			parameters: schema({}),
			async execute(_args, ctx) {
				requireCapability(ctx, "read");
				return {
					text: JSON.stringify(await conversationMembers(store, sourceConversation(ctx), ctx.agent, ctx.signal)),
				};
			},
		},
		{
			name: "conversation_attachment_read",
			description:
				"Read a text attachment from a recorded inbound message in the current conversation by internal event id and zero-based attachment index. Uses the received cached file, not arbitrary paths. offset/limit count characters; binary formats require an appropriate parser and are not understood content.",
			parameters: schema({
				message: text(),
				attachment: Type.Integer({ minimum: 0 }),
				offset: Type.Optional(Type.Integer({ minimum: 0 })),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20000 })),
			}),
			async execute(args, ctx) {
				requireCapability(ctx, "read");
				const a = args as { message: string; attachment: number; offset?: number; limit?: number };
				const event = await store.events.get(a.message);
				if (!event || event.type !== "message.in" || event.conv !== sourceConversation(ctx))
					throw new Error("附件消息不属于当前来源会话。");
				const attachment = (event.data as { attachments?: Attachment[] }).attachments?.[a.attachment];
				if (!attachment) throw new Error("该消息没有此附件。");
				if (
					!(attachment.mime.startsWith("text/") || /\.(md|txt|json|csv|log|yaml|yml|xml)$/i.test(attachment.name ?? ""))
				)
					throw new Error("此附件不是支持的文本文件；未解析其内容。");
				if ((attachment.bytes ?? 0) > 2 * 1024 * 1024) throw new Error("文本附件超过 2 MiB 读取上限。");
				let path: string;
				if (/^https?:/.test(attachment.uri)) {
					if (ctx.env.id !== "node:local") throw new Error("本机附件缓存不在当前执行环境中。");
					path = join(home, ".yonder", "attachments", `${event.id}-${a.attachment}`);
				} else if (attachment.uri.startsWith("file:")) path = fileURLToPath(attachment.uri);
				else throw new Error("附件没有可读取的已接收文件引用。");
				const content = await workspaceFiles(ctx.env, ctx.signal).readFile(path);
				if (attachment.bytes !== undefined && Buffer.byteLength(content, "utf8") !== attachment.bytes)
					throw new Error("接收缓存大小与消息附件元数据不一致，未取得可验证的真实附件。");
				if (content.length > 2 * 1024 * 1024) throw new Error("文本附件超过 2 MiB 读取上限。");
				if (content.includes("\0")) throw new Error("附件含二进制数据；未作为文本解析。");
				const offset = a.offset ?? 0,
					end = Math.min(content.length, offset + (a.limit ?? 12000));
				return {
					text: JSON.stringify({
						message: event.id,
						attachment: a.attachment,
						name: attachment.name,
						offset,
						text: content.slice(offset, end),
						total: content.length,
						...(end < content.length ? { next: end } : {}),
					}),
				};
			},
		},
	];
	for (const d of definitions) coreToolCapabilities[d.name] = ["read"];
	return definitions.map(tool);
}
