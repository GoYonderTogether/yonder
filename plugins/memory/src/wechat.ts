import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { DateTime } from "luxon";
import { Type } from "typebox";
import { capture } from "./capture.js";
import type { Config } from "./config.js";
import { pluginContext, writeContext } from "./ingest.js";
import { manifest, once } from "./manifest.js";
import { Store } from "./store.js";

const exec = promisify(execFile);
interface Message {
	id: number;
	chat: string;
	timestamp?: number;
	text?: string;
	url?: string;
	media?: { kind?: string; name?: string };
	normalized?: { kind?: string; name?: string; url?: string };
}
export const importSchema = Type.Object(
	{
		source: Type.Literal("wechat"),
		chat: Type.String({ minLength: 1 }),
		since: Type.Optional(Type.String()),
		until: Type.Optional(Type.String()),
		dryRun: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export interface ImportArgs {
	source: "wechat";
	chat: string;
	since?: string;
	until?: string;
	dryRun?: boolean;
}
export class Wechat {
	readonly store: Store;
	constructor(
		readonly api: PluginAPI,
		readonly config: Config,
	) {
		this.store = new Store(config.root);
	}
	async command(args: string[], signal: AbortSignal): Promise<Record<string, unknown>> {
		try {
			const { stdout } = await exec(
				this.config.sources?.wechat?.cliPath ?? join(homedir(), ".local/bin/wechat-context"),
				args,
				{ signal, timeout: 65000, maxBuffer: 8 * 1024 * 1024 },
			);
			const data = JSON.parse(stdout);
			if (data.ok !== true) throw new Error();
			return data;
		} catch {
			signal.throwIfAborted();
			throw new Error("WeChat archive read failed; check CLI and sync status");
		}
	}
	async *history(chat: string, signal: AbortSignal): AsyncGenerator<Message> {
		if (!this.config.sources?.wechat?.chats?.some((c) => c.chat === chat))
			throw new Error("WeChat chat is not allowlisted");
		let before: number | undefined;
		const cursors = new Set<number>();
		do {
			const page = await this.command(
				[
					"history",
					"--chat",
					chat,
					"--normalized",
					"--limit",
					"100",
					...(before === undefined ? [] : ["--before", String(before)]),
				],
				signal,
			);
			if (!Array.isArray(page.messages)) throw new Error("Invalid WeChat history page");
			for (const message of page.messages as Message[]) {
				if (message.chat !== chat) throw new Error("WeChat history escaped allowlist");
				yield message;
			}
			const next = typeof page.nextBefore === "number" ? page.nextBefore : undefined;
			if (next !== undefined && cursors.has(next)) throw new Error("WeChat pagination repeated its cursor");
			if (next !== undefined) cursors.add(next);
			before = next;
		} while (before !== undefined);
	}
	body(m: Message) {
		let text = m.text ?? "";
		const url = m.url ?? m.normalized?.url;
		if (url) text += `\n链接: ${url}`;
		const media = m.media ?? (m.normalized?.kind && m.normalized.kind !== "text" ? m.normalized : undefined);
		if (media) text += `\n媒体: ${media.kind ?? "unknown"} ${media.name ?? ""}（仅元数据）`;
		return text;
	}
	async record(m: Message, ctx: ToolContext) {
		const source = this.config.sources?.wechat?.chats?.find((c) => c.chat === m.chat);
		if (!source || !Number.isSafeInteger(m.id) || !m.timestamp || !Number.isFinite(m.timestamp)) return false;
		return once(this.store, `wechat:${m.chat}:${m.id}`, writeContext("memory.wechat", ctx.signal), async () => {
			const result = await capture(
				this.config,
				this.store,
				{ text: this.body(m), when: DateTime.fromSeconds(m.timestamp!, { zone: this.config.timezone }).toISO()! },
				ctx,
				(e) => this.api.events.emit(e),
				{ source: source.self ? "wechat-self" : "wechat", ref: `(ref: conv:wechat-archive:${m.chat}; msg:${m.id})` },
			);
			return result.path;
		});
	}
	async material(event: YEvent) {
		const data = event.data as { chat?: string; messages?: Message[] };
		if (!this.config.sources?.wechat?.chats?.some((c) => c.chat === data.chat)) return;
		for (const m of data.messages ?? []) {
			if (m.chat !== data.chat) continue;
			await this.record(m, pluginContext(new AbortController().signal));
		}
	}
	async import(args: ImportArgs, ctx: ToolContext) {
		for (const v of [args.since, args.until])
			if (v && !DateTime.fromISO(v, { zone: this.config.timezone }).isValid) throw new Error("Invalid import date");
		if (args.since && args.until && args.since > args.until) throw new Error("since must not follow until");
		let read = 0,
			written = 0,
			skipped = 0;
		const known = (await manifest(this.config.root)).keys;
		for await (const m of this.history(args.chat, ctx.signal)) {
			read++;
			const day = m.timestamp ? DateTime.fromSeconds(m.timestamp, { zone: this.config.timezone }).toISODate() : null;
			if (
				!day ||
				(args.since && day < args.since) ||
				(args.until && day > args.until) ||
				known[`wechat:${m.chat}:${m.id}`]
			) {
				skipped++;
				continue;
			}
			if (args.dryRun) {
				skipped++;
				continue;
			}
			if (await this.record(m, ctx)) written++;
			else skipped++;
		}
		return { read, written, skipped };
	}
}
