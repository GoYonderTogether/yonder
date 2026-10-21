import { readFileSync } from "node:fs";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type Attachment,
	acct,
	type ChannelIO,
	conv,
	type EventInput,
	type EventQuery,
	type PluginAPI,
	type SessionsAPI,
} from "@yonder/sdk";
import { z } from "zod";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;
const text = z.string().min(1);
const optionalText = text.optional();
const attachment = z
	.object({
		kind: z.enum(["image", "audio", "video", "file"]),
		mime: text,
		uri: text,
		name: optionalText,
		bytes: z.number().int().nonnegative().optional(),
	})
	.strict() as z.ZodType<Attachment>;
const input = z.object({ text: z.string(), attachments: z.array(attachment).optional() }).strict();
const eventQuery = z
	.object({
		type: optionalText,
		from: optionalText,
		conv: optionalText,
		agent: optionalText,
		since: optionalText,
		until: optionalText,
		after: optionalText,
		limit: z.number().int().positive().optional(),
	})
	.strict() as z.ZodType<EventQuery>;
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value ?? null) }] });

export function createControlServer(api: PluginAPI, io: ChannelIO, channel: string, account: string): McpServer {
	const server = new McpServer({ name: "yonder-harness", version });
	const add = <T extends z.ZodType>(
		name: string,
		description: string,
		schema: T,
		call: (args: z.output<T>) => unknown | Promise<unknown>,
	) =>
		server.registerTool(`${api.id}_${name}`, { description, inputSchema: schema }, (async (args: z.output<T>) =>
			json(await call(args))) as ToolCallback<T>);
	const event = z.union([
		z
			.object({
				type: z.literal("message.in"),
				conversation: optionalText,
				parent: optionalText,
				data: z
					.object({
						text: z.string(),
						kind: z.literal("dm").default("dm"),
						attachments: z.array(attachment).optional(),
						mentioned: z.boolean().optional(),
						msgId: optionalText,
						replyTo: optionalText,
					})
					.strict(),
			})
			.strict(),
		z
			.object({
				type: text.startsWith(`${api.id}.`),
				conversation: optionalText,
				parent: optionalText,
				data: z.record(z.string(), z.unknown()),
			})
			.strict(),
	]);
	const publish = (value: z.output<typeof event>, wait: boolean) => {
		const message: EventInput = {
			type: value.type,
			data: value.data,
			...(value.parent ? { parent: value.parent } : {}),
			...(value.conversation ? { conv: conv(channel, value.conversation) } : {}),
		};
		if (value.type === "message.in") {
			message.from = acct(channel, account);
			message.conv = conv(channel, value.conversation ?? "main");
			return wait ? io.ask(message) : io.emit(message);
		}
		message.from = `plugin:${api.id}`;
		return wait ? api.events.ask(message) : api.events.emit(message);
	};
	add("events_emit", "接纳输入并返回真实事件；消息按绑定处理，不等待运行结束。", z.object({ event }).strict(), (args) =>
		publish(args.event, false),
	);
	add("events_ask", "输入经绑定执行并返回原生 AskResult；断连不暗中中止运行。", z.object({ event }).strict(), (args) =>
		publish(args.event, true),
	);
	add(
		"events_query",
		"查询原生事件与运行结果，用 after 翻页。",
		z.object({ query: eventQuery.optional() }).strict(),
		(args) => api.events.query(args.query ?? {}),
	);
	const filter = z
		.object({
			agent: optionalText,
			mode: z.enum(["main", "persistent", "ephemeral", "task"]).optional(),
			open: z.boolean().optional(),
		})
		.strict();
	add("sessions_list", "列出原生会话。", z.object({ filter: filter.optional() }).strict(), (args) =>
		api.sessions.list((args.filter ?? {}) as Parameters<SessionsAPI["list"]>[0]),
	);
	const id = z.object({ id: text }).strict();
	add("sessions_get", "读取指定会话。", id, (args) => api.sessions.get(args.id));
	add(
		"sessions_open",
		"只创建预设任务会话，不绕过绑定打开常驻 agent。",
		z
			.object({
				preset: text,
				parent: optionalText,
				close: z.enum(["run-end", "manual"]).optional(),
				capabilities: z
					.array(z.enum(["read", "write", "exec", "network", "message", "cross-agent", "admin"]))
					.optional(),
			})
			.strict(),
		(args) => api.sessions.open(args as Parameters<SessionsAPI["open"]>[0]),
	);
	add(
		"sessions_submit",
		"向预设会话输入；wait=false 只接纳，结果查询原生事件/转录。",
		z
			.object({
				id: text,
				input,
				wait: z.boolean().default(false),
				busy: z.enum(["followup", "steer", "interrupt"]).optional(),
			})
			.strict(),
		(args) =>
			api.sessions.submit(args.id, args.input as Parameters<SessionsAPI["submit"]>[1], {
				wait: args.wait,
				...(args.busy ? { busy: args.busy } : {}),
			}),
	);
	server.registerTool(
		`${api.id}_sessions_watch`,
		{
			description: "被动观察原生会话；支持标准进度通知。结束/断连只解除观察，不创建输入或 abort。",
			inputSchema: z.object({ id: text, milliseconds: z.number().int().min(1).max(60000).default(10000) }).strict(),
		},
		async (args, extra) => {
			if (!api.sessions.observe) throw new Error("Session observation unavailable");
			const updates: import("@yonder/sdk").SessionUpdate[] = [];
			let progress = 0,
				truncated = false;
			const dispose = await api.sessions.observe(args.id, async (update) => {
				if (updates.length >= 256) {
					updates.shift();
					truncated = true;
				}
				updates.push(update);
				const progressToken = extra._meta?.progressToken;
				if (progressToken !== undefined)
					await extra.sendNotification({
						method: "notifications/progress",
						params: { progressToken, progress: ++progress, message: JSON.stringify(update) },
					});
			});
			try {
				await new Promise<void>((resolve) => {
					const done = () => {
						clearTimeout(timer);
						extra.signal.removeEventListener("abort", done);
						resolve();
					};
					const timer = setTimeout(done, args.milliseconds);
					if (extra.signal.aborted) done();
					else extra.signal.addEventListener("abort", done, { once: true });
				});
			} finally {
				await dispose();
			}
			return json({ session: args.id, updates, truncated });
		},
	);
	add("sessions_abort", "显式中止指定会话及其排队输入。", id, (args) => api.sessions.abort(args.id));
	add("sessions_close", "关闭指定会话。", id, (args) => api.sessions.close(args.id));
	add(
		"sessions_transcript",
		"读取原生转录，包括工具与输入关联。",
		z
			.object({
				id: text,
				from: z.number().int().nonnegative().optional(),
				limit: z.number().int().positive().optional(),
			})
			.strict(),
		(args) => api.sessions.transcript(args.id, args as Parameters<SessionsAPI["transcript"]>[1]),
	);
	const ref = z.object({ ref: text }).strict();
	add("identity_account", "查询账号身份。", ref, (args) => api.identity.account(args.ref));
	add("identity_person", "查询人物及关联账号。", ref, (args) => api.identity.person(args.ref));
	add("identity_lookup", "查询账号、会话与 agent 引用。", ref, (args) => api.identity.lookup(args.ref));
	add("identity_relation", "查询指定 agent 与账号的关系。", z.object({ agent: text, account: text }).strict(), (args) =>
		api.identity.relation(args.agent, args.account),
	);
	add(
		"identity_createPerson",
		"创建或更新人物。",
		z.object({ id: text, name: text, note: optionalText }).strict(),
		(args) => api.identity.createPerson(args as Parameters<PluginAPI["identity"]["createPerson"]>[0]),
	);
	add("identity_link", "关联明确的账号与人物引用。", z.object({ account: text, person: text }).strict(), (args) =>
		api.identity.link(args.account, args.person),
	);
	add("identity_unlink", "解除明确账号的身份关联。", z.object({ account: text }).strict(), (args) =>
		api.identity.unlink(args.account),
	);
	add(
		"messages_send",
		"通过现有渠道发送到明确的 person/acct/conv 目标。",
		z.object({ to: text, via: optionalText, text: z.string(), attachments: z.array(attachment).optional() }).strict(),
		(args) => api.messages.send(args as Parameters<PluginAPI["messages"]["send"]>[0]),
	);
	return server;
}
