import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { PluginAPI, ToolContext, TSchema } from "@yonder/sdk";
import type { FeishuApi } from "./client.js";
import { object, required, string } from "./protocol.js";

export type TaskRow = {
	id: string;
	status: "queued" | "working" | "done" | "blocked" | "unverified";
	deliverable: string;
	acceptance: string;
	assignee?: string;
	forwardedVerbatim?: boolean;
};
type BoardReceipt = {
	messageId: string;
	revision: number;
	text: string;
	source: string;
	state: "confirmed" | "unknown" | "pending";
};
export const boardMime = "application/vnd.yonder.task-board+json";
type ShortLists = { advancing?: string[]; needsOwner?: string[] };
type Source = { chat: string; sender: string; message: string; time: number };
type Receipt = {
	id: string;
	source: Source;
	session: string;
	agent: string | null;
	messageId?: string;
	revision: number;
	state: "pending" | "confirmed" | "unknown";
	retired: boolean;
	acknowledged: boolean;
	created: number;
	rows: TaskRow[];
	actions: string[];
	notifications?: Record<string, "pending" | "confirmed" | "unknown">;
	lists?: ShortLists;
};
const shortText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const shortList = { type: "array", maxItems: 3, items: shortText(160) };
const taskRows = {
	type: "array",
	minItems: 1,
	maxItems: 12,
	items: {
		type: "object",
		additionalProperties: false,
		required: ["id", "status", "deliverable", "acceptance"],
		properties: {
			id: shortText(80),
			status: { enum: ["queued", "working", "done", "blocked", "unverified"] },
			deliverable: shortText(160),
			acceptance: shortText(160),
			assignee: shortText(80),
			forwardedVerbatim: { type: "boolean" },
		},
	},
};
/** Tool input contract; documented optional fields must pass the host's strict argument validation. */
export const taskCardParameters = {
	type: "object",
	additionalProperties: false,
	required: ["instance", "action"],
	properties: {
		instance: { type: "string", minLength: 1 },
		action: { enum: ["create", "update", "get"] },
		sourceEvent: { type: "string", minLength: 1 },
		id: { type: "string", minLength: 1 },
		expectedRevision: { type: "integer", minimum: 1 },
		rows: taskRows,
		lists: {
			type: "object",
			additionalProperties: false,
			properties: { advancing: shortList, needsOwner: shortList },
		},
	},
	anyOf: [
		{ properties: { action: { const: "create" } }, required: ["sourceEvent", "rows"] },
		{ properties: { action: { const: "update" } }, required: ["id", "expectedRevision", "rows"] },
		{ properties: { action: { const: "get" } }, required: ["id"] },
	],
} as TSchema;
const labels = {
	queued: "⚪ 待开始",
	working: "🟡 实现中",
	done: "🟢 已完成",
	blocked: "🔴 已阻塞",
	unverified: "⚪ 未验收",
};
const toast = (content: string, type = "error") => ({ toast: { type, content } });
const sourceKey = (source: Source) => JSON.stringify([source.chat, source.sender]);

/** Presentation receipts only: no task execution, transcript, queue or permissions. */
export class FeishuTaskCards {
	private readonly boards = new Map<string, BoardReceipt>();
	private boardTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
	private readonly receipts = new Map<string, Receipt>();
	private readonly latest = new Map<string, Source>();
	private tail: Promise<unknown> = Promise.resolve();
	private ready = false;
	private lastPatch = 0;
	private operations = 0;
	private readonly directory: string;
	constructor(
		private readonly instance: string,
		private readonly client: FeishuApi,
		private readonly api: PluginAPI,
		private readonly send: (target: string, card: object, signal: AbortSignal) => Promise<string>,
	) {
		this.directory = join(api.paths.data, instance);
	}
	private serial<T>(work: () => Promise<T>): Promise<T> {
		this.operations++;
		const next = this.tail
			.catch(() => {})
			.then(work)
			.finally(() => {
				this.operations--;
			});
		this.tail = next;
		return next;
	}
	async start(): Promise<void> {
		try {
			const stored = object(JSON.parse(await readFile(join(this.directory, "task-cards.json"), "utf8")));
			if (stored.version !== 1 || !Array.isArray(stored.receipts) || !Array.isArray(stored.latest))
				throw new Error("Invalid Feishu task card receipt file");
			for (const [target, value] of Object.entries(object(stored.boards))) {
				const receipt = value as BoardReceipt;
				// Published URLs belong to the old process. An explicit show reconnects them.
				receipt.state = "unknown";
				this.boards.set(target, receipt);
			}
			for (const value of stored.receipts) {
				const row = value as Receipt;
				if (
					!row.id ||
					!row.source?.chat ||
					!row.source.sender ||
					!row.source.message ||
					!Array.isArray(row.rows) ||
					!Number.isInteger(row.revision) ||
					!Array.isArray(row.actions) ||
					!["pending", "confirmed", "unknown"].includes(row.state)
				)
					throw new Error("Invalid Feishu task card receipt");
				if (row.state === "pending") row.state = "unknown";
				for (const [key, state] of Object.entries(row.notifications ?? {}))
					if (state === "pending" && row.notifications) row.notifications[key] = "unknown";
				this.receipts.set(row.id, row);
			}
			for (const value of stored.latest) {
				const source = value as Source;
				if (!source.chat || !source.sender || !source.message || !Number.isFinite(source.time))
					throw new Error("Invalid Feishu task card source");
				this.latest.set(sourceKey(source), source);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		this.ready = true;
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		await writeFile(join(this.directory, "task-board.json"), JSON.stringify({ pid: process.pid, mime: boardMime }), {
			mode: 0o600,
		});
	}
	private async save(): Promise<void> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const temporary = join(this.directory, `task-cards-${randomUUID()}.tmp`);
		await writeFile(
			temporary,
			JSON.stringify({
				version: 1,
				receipts: [...this.receipts.values()],
				latest: [...this.latest.values()],
				boards: Object.fromEntries(this.boards),
			}),
			{ mode: 0o600 },
		);
		await rename(temporary, join(this.directory, "task-cards.json"));
	}
	async stop(): Promise<void> {
		this.ready = false;
		clearTimeout(this.boardTimer);
		await unlink(join(this.directory, "task-board.json")).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
		await this.tail.catch(() => {});
	}
	private pollBoards() {
		if (this.boardTimer || !this.ready) return;
		this.boardTimer = globalThis.setTimeout(async () => {
			try {
				await this.refreshBoards();
			} catch (error) {
				this.api.log.warn("Task board refresh failed", { error: this.client.safe(error) });
			} finally {
				this.boardTimer = undefined;
				this.pollBoards();
			}
		}, 2000);
		this.boardTimer.unref();
	}
	private boardCard(row: BoardReceipt) {
		const card = {
			config: { update_multi: true },
			header: { title: { tag: "plain_text", content: `任务看板 · v${row.revision}` } },
			elements: [{ tag: "div", text: { tag: "plain_text", content: row.text } }],
		};
		if (Buffer.byteLength(JSON.stringify(card)) > 30000) throw new Error("Feishu task card exceeds 30000 bytes");
		return card;
	}
	private async boardText(source: string, signal: AbortSignal) {
		const url = new URL(source);
		if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Invalid board source");
		const response = await fetch(url, { signal, redirect: "error" });
		if (!response.ok) throw new Error("Task board unavailable");
		const data = (await response.json()) as { text?: unknown };
		if (typeof data.text !== "string") throw new Error("Invalid task board");
		return data.text;
	}
	/** Explicit requests always send the current board at the end of the conversation. */
	showBoard(target: string, source: string, signal: AbortSignal): Promise<string> {
		return this.serial(async () => {
			const text = await this.boardText(source, signal);
			const previous = this.boards.get(target);
			const row: BoardReceipt = {
				source,
				text,
				messageId: "",
				revision: (previous?.revision ?? 0) + 1,
				state: "pending",
			};
			const card = this.boardCard(row);
			this.boards.set(target, row);
			await this.save();
			try {
				row.messageId = await this.send(target, card, signal);
				row.state = "confirmed";
				await this.save();
				this.pollBoards();
				return row.messageId;
			} catch (error) {
				row.state = "unknown";
				await this.save();
				throw error;
			}
		});
	}
	async refreshBoards() {
		return this.serial(async () => {
			for (const row of this.boards.values()) {
				if (row.state !== "confirmed") continue;
				try {
					const signal = AbortSignal.timeout(5000);
					const text = await this.boardText(row.source, signal);
					if (text === row.text) continue;
					row.text = text;
					row.revision++;
					row.state = "pending";
					await this.save();
					await this.patchCard(row.messageId, this.boardCard(row), signal);
					row.state = "confirmed";
					await this.save();
				} catch (error) {
					row.state = "unknown";
					await this.save();
					this.api.log.warn("Task board update unavailable", { error: this.client.safe(error) });
				}
			}
		});
	}
	private async patchCard(messageId: string, card: object, signal: AbortSignal) {
		await setTimeout(Math.max(0, 250 - (Date.now() - this.lastPatch)), undefined, { signal });
		this.lastPatch = Date.now();
		await this.client.request(
			`/im/v1/messages/${encodeURIComponent(messageId)}`,
			"PATCH",
			{ content: JSON.stringify(card) },
			signal,
		);
	}
	/** Called before inbound emission, including recovery; invalidates in memory before any network await. */
	observe(chat: string, sender: string, message: string, time: number): Promise<void> {
		if (!this.ready || !Number.isFinite(time)) return Promise.resolve();
		const source = { chat, sender, message, time },
			key = sourceKey(source),
			previous = this.latest.get(key);
		if (previous && (time < previous.time || message === previous.message)) return Promise.resolve();
		// Same millisecond does not establish native causal ordering. Conservatively retire on either new ID.
		this.latest.set(key, source);
		const retired = [...this.receipts.values()].filter(
			(row) => sourceKey(row.source) === key && row.source.message !== message && !row.retired,
		);
		for (const row of retired) row.retired = true;
		return this.serial(async () => {
			await this.save();
			for (const row of retired) {
				if (row.state !== "confirmed" || !row.messageId) continue;
				try {
					await this.patch(row, AbortSignal.timeout(30000));
				} catch (error) {
					this.api.log.warn("Feishu task card retirement unavailable", {
						instance: this.instance,
						messageId: row.messageId,
						error: this.client.safe(error),
					});
				}
			}
		});
	}
	private current(row: Receipt): boolean {
		return (
			!row.retired &&
			this.latest.get(sourceKey(row.source))?.message === row.source.message &&
			Date.now() - row.created < 14 * 86400000
		);
	}
	private card(row: Receipt): object {
		const clean = (value: string) => value.replace(/[\r\n|]/g, " ").replace(/[<>]/g, "");
		const tableRow = (cells: string[]) => ({
			tag: "column_set",
			flex_mode: "none",
			columns: cells.map((content) => ({
				tag: "column",
				width: "weighted",
				weight: 1,
				elements: [{ tag: "div", text: { tag: "plain_text", content: clean(content) } }],
			})),
		});
		const table = [
			tableRow(["状态", "任务", "负责人", "原文程序转发", "交付物", "验收点"]),
			...row.rows.map((item) =>
				tableRow([
					labels[item.status],
					item.id,
					item.assignee ?? "未注明",
					item.forwardedVerbatim === undefined ? "未注明" : item.forwardedVerbatim ? "是" : "否",
					item.deliverable,
					item.acceptance,
				]),
			),
		];
		const button = (action: string, text: string) => ({
			tag: "button",
			text: { tag: "plain_text", content: text },
			value: { yonder_task_card: row.id, revision: row.revision, action },
		});
		const card = {
			config: { update_multi: true },
			header: { title: { tag: "plain_text", content: row.retired ? "任务状态（已归档）" : "任务状态" } },
			elements: [
				...table,
				...(
					[
						["我在推进，无需您操作", row.lists?.advancing],
						["需要您处理", row.lists?.needsOwner],
					] as const
				).map(([title, items]) => ({
					tag: "div",
					text: {
						tag: "plain_text",
						content: `${title}\n${items?.length ? items.map((item) => `• ${clean(item)}`).join("\n") : "无"}`,
					},
				})),
				...(this.current(row)
					? [
							{
								tag: "action",
								actions: [
									button("details", "了解任务详情"),
									...(!row.acknowledged ? [button("acknowledge", "确认收到（仅通知）")] : []),
								],
							},
						]
					: []),
			],
		};
		if (Buffer.byteLength(JSON.stringify(card)) > 30000) throw new Error("Feishu task card exceeds 30000 bytes");
		return card;
	}
	private async patch(row: Receipt, signal: AbortSignal): Promise<void> {
		row.state = "pending";
		await this.save(); // Crash or lost receipt never causes automatic replay.
		try {
			await this.patchCard(required(row.messageId, "Card message ID"), this.card(row), signal);
			row.state = "confirmed";
			await this.save();
		} catch (error) {
			row.state = "unknown";
			await this.save();
			throw error;
		}
	}
	private publicReceipt(row: Receipt): object {
		return {
			ok: row.state === "confirmed",
			id: row.id,
			messageId: row.messageId,
			revision: row.revision,
			state: row.state,
			retired: !this.current(row),
			acknowledged: row.acknowledged,
			notifications: row.notifications ?? {},
			sourceMessageId: row.source.message,
		};
	}
	async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<object> {
		return this.serial(async () => {
			if (!this.ready) throw new Error("Feishu task cards are not ready");
			ctx.signal.throwIfAborted();
			const action = required(args.action, "action");
			if (action === "create") {
				const event = [...(ctx.events ?? []), ...(ctx.event ? [ctx.event] : [])].find(
					(item) => item.id === args.sourceEvent,
				);
				if (
					event?.type !== "message.in" ||
					!event.conv?.startsWith(`conv:${this.instance}:`) ||
					!event.from?.startsWith(`acct:${this.instance}:`)
				)
					throw new Error("Creation requires an actual Feishu message.in source of this run");
				const originals = object(event.data).originals;
				const data = Array.isArray(originals) ? object(originals.at(-1)) : object(event.data);
				const source = {
					chat: event.conv,
					sender: event.from,
					message: string(data.messageId) || required(data.msgId, "Source message ID"),
					time: Number(data.createdAt),
				};
				if (this.latest.get(sourceKey(source))?.message !== source.message)
					throw new Error("Source is no longer the latest input; do not create an old feedback anchor");
				const existing = [...this.receipts.values()].find(
					(row) => row.source.chat === source.chat && row.source.message === source.message,
				);
				if (existing) {
					this.owned(existing, ctx);
					return this.publicReceipt(existing);
				}
				const row: Receipt = {
					id: randomUUID(),
					source,
					session: ctx.session,
					agent: ctx.agent,
					revision: 1,
					state: "pending",
					retired: false,
					acknowledged: false,
					created: Date.now(),
					rows: args.rows as TaskRow[],
					...(args.lists === undefined ? {} : { lists: args.lists as ShortLists }),
					actions: [],
				};
				this.receipts.set(row.id, row);
				await this.save();
				try {
					row.messageId = await this.send(source.chat, this.card(row), ctx.signal);
					row.state = "confirmed";
					await this.save();
					// A new user input may arrive while the HTTP send is in flight.
					if (!this.current(row)) await this.patch(row, AbortSignal.timeout(30000));
					await this.record(row, ctx);
				} catch (error) {
					if (row.state === "pending") row.state = "unknown";
					await this.save();
					return { ...this.publicReceipt(row), ok: false, error: this.client.safe(error), retry: "forbidden" };
				}
				return this.publicReceipt(row);
			}
			const row = this.receipts.get(required(args.id, "id"));
			if (!row) throw new Error("Unknown managed card receipt");
			this.owned(row, ctx);
			if (action === "get") return this.publicReceipt(row);
			if (action !== "update") throw new Error("Unknown task card action");
			if (!this.current(row)) throw new Error("Card is retired or expired; old results must not edit a newer anchor");
			if (row.state !== "confirmed") throw new Error("Previous card effect is unknown; inspect receipt, do not retry");
			if (args.expectedRevision !== row.revision) throw new Error("Card revision conflict; read current receipt");
			row.rows = args.rows as TaskRow[];
			if (args.lists !== undefined) row.lists = args.lists as ShortLists;
			row.revision++;
			try {
				await this.patch(row, ctx.signal);
				await this.record(row, ctx);
			} catch (error) {
				return { ...this.publicReceipt(row), ok: false, error: this.client.safe(error), retry: "forbidden" };
			}
			return this.publicReceipt(row);
		});
	}
	private async record(row: Receipt, ctx: ToolContext): Promise<void> {
		await this.api.events.emit({
			type: "channel-feishu.task-card-updated",
			...(ctx.event ? { parent: ctx.event.id } : {}),
			conv: row.source.chat,
			from: row.source.sender,
			data: {
				msgId: `task-card:${row.id}:${row.revision}`,
				instance: this.instance,
				messageId: row.messageId,
				receipt: row.id,
				revision: row.revision,
				session: row.session,
				sourceMessageId: row.source.message,
			},
		});
	}
	private owned(row: Receipt, ctx: ToolContext): void {
		if (row.session !== ctx.session || row.agent !== ctx.agent)
			throw new Error("Card belongs to another session or agent");
	}
	/** Reserved actions are always intercepted, never fall through to generic callback routing. */
	async callback(sender: string, chat: string, messageId: string, value: Record<string, unknown>): Promise<object> {
		// Native callbacks must not queue behind a slow remote update (platform response deadline).
		if (this.operations) return toast("状态回执处理中，请查看最新卡片", "info");
		return this.serial(async () => {
			const row = this.receipts.get(string(value.yonder_task_card));
			if (
				!this.ready ||
				!row ||
				row.source.sender !== sender ||
				row.source.chat !== chat ||
				row.messageId !== messageId
			)
				return toast("仅任务发起者可操作此卡片");
			if (!this.current(row) || row.state !== "confirmed" || value.revision !== row.revision)
				return toast("此按钮已过期，请查看最新状态卡");
			const action = string(value.action);
			if (!["details", "acknowledge"].includes(action)) return toast("未知卡片操作");
			if (
				Object.entries(row.notifications ?? {}).some(
					([key, state]) => key.endsWith(`:${action}`) && state !== "confirmed",
				)
			)
				return toast("通知结果未知；请核对事件记录，勿重复点击");
			const key = `${row.revision}:${action}`;
			if (row.actions.includes(key) || (action === "acknowledge" && row.acknowledged))
				return row.notifications?.[key] && row.notifications[key] !== "confirmed"
					? toast("通知结果未知；请核对事件记录，勿重复点击")
					: toast("按钮已消费，无需重复操作", "info");
			// Persist consumption before emitting; admission may succeed even if emit throws. Never replay.
			row.actions.push(key);
			if (action === "acknowledge") {
				row.acknowledged = true;
				row.revision++;
			}
			row.notifications ??= {};
			row.notifications[key] = "pending";
			try {
				await this.save();
				await this.api.events.emit({
					type: "channel-feishu.card-action",
					from: sender,
					conv: chat,
					data: {
						msgId: `task-card:${row.id}:${key}`,
						instance: this.instance,
						messageId,
						operator: sender,
						source: "feishu-websocket",
						action: { tag: "button", value: { action, taskIds: row.rows.map((item) => item.id), receipt: row.id } },
						authorization: "none",
					},
				});
				row.notifications[key] = "confirmed";
				await this.save();
			} catch (error) {
				row.notifications[key] = "unknown";
				await this.save().catch(() => {});
				this.api.log.warn("Feishu task card notification outcome unknown; do not retry", {
					instance: this.instance,
					error: this.client.safe(error),
				});
				return toast("通知结果未知；请核对事件记录，勿重复点击");
			}
			if (action === "acknowledge") {
				// Do not hold the native callback response open for a remote PATCH.
				void this.serial(async () => {
					try {
						await this.patch(row, AbortSignal.timeout(30000));
					} catch (error) {
						this.api.log.warn("Feishu task card acknowledgment update unavailable", {
							instance: this.instance,
							messageId,
							error: this.client.safe(error),
						});
					}
				});
			}
			return toast(
				action === "details" ? "已请求任务详情" : "已通知收到；未安排下一任务，也不授权或取消操作",
				"success",
			);
		});
	}
}
