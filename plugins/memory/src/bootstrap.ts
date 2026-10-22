import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PluginAPI, ToolContext, Trigger } from "@yonder/sdk";
import { Type } from "typebox";
import type { Config } from "./config.js";
import { initialize, readText, safePath } from "./files.js";
import { writeContext } from "./ingest.js";
import { status } from "./status.js";
import { Store, serial } from "./store.js";
import type { Wechat } from "./wechat.js";

const reasons = ["first-run", "source-new", "source-stale", "backlog"];
export const bootstrapSchema = Type.Union([
	Type.Object({ op: Type.Literal("audit"), model: Type.Optional(Type.String()) }, { additionalProperties: false }),
	Type.Object({ op: Type.Literal("state") }, { additionalProperties: false }),
	Type.Object(
		{
			op: Type.Literal("ack"),
			reason: Type.Union(reasons.map((r) => Type.Literal(r))),
			snoozeDays: Type.Optional(Type.Number({ minimum: 0 })),
		},
		{ additionalProperties: false },
	),
]);
export interface BootstrapArgs {
	op: string;
	model?: string;
	reason?: string;
	snoozeDays?: number;
}
interface State {
	initialized?: string;
	acked: Record<string, { at: string; until: string }>;
	lastEmitted: Record<string, string>;
	audited: string[];
}
interface Count {
	name: string;
	files: number;
	bytes: number;
	chars: number;
	tokens: number;
}
export class Bootstrap {
	readonly store: Store;
	private timer: ReturnType<typeof setInterval> | undefined;
	private lifetime = new AbortController();
	private work: Promise<void> = Promise.resolve();
	constructor(
		readonly api: PluginAPI,
		readonly config: Config,
		readonly wechat: Wechat,
		readonly errors: string[],
	) {
		this.store = new Store(config.root);
	}
	async state(): Promise<State> {
		try {
			return {
				acked: {},
				lastEmitted: {},
				audited: [],
				...JSON.parse(await readText(this.config.root, ".memory/state.json")),
			};
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return { acked: {}, lastEmitted: {}, audited: [] };
			throw e;
		}
	}
	sources() {
		return [
			...(this.config.roots ?? []).map((r) => r.name),
			...(this.config.sources?.wechat?.chats ?? []).map((c) => c.chat),
		];
	}
	async audit(model: string | undefined, signal: AbortSignal) {
		const { countTokens } = await import("gpt-tokenizer/encoding/o200k_base");
		const unestimated: Array<{ path: string; reason: string }> = [];
		const count = async (root: string, name: string, prefix = ""): Promise<Count> => {
			const result: Count = { name, files: 0, bytes: 0, chars: 0, tokens: 0 };
			async function walk(path: string) {
				let entries: import("node:fs").Dirent[];
				try {
					entries = await readdir(await safePath(root, path), { withFileTypes: true });
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
					throw e;
				}
				for (const entry of entries) {
					signal.throwIfAborted();
					if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
					const child = join(path, entry.name);
					if (entry.isDirectory()) {
						await walk(child);
						continue;
					}
					if (!entry.isFile()) continue;
					result.files++;
					result.bytes += (await stat(await safePath(root, child))).size;
					if (/\.(md|markdown|txt)$/i.test(child)) {
						const text = await readText(root, child);
						result.chars += text.length;
						result.tokens += countTokens(text, { disallowedSpecial: new Set() });
					} else unestimated.push({ path: `${prefix}${child}`, reason: "not converted" });
				}
			}
			await walk("");
			return result;
		};
		const zones: Count[] = [];
		for (const name of ["mine", "raw", "inbox", "life", "timeline", "me", "projects", "private", "archive"])
			zones.push(await count(this.config.root + "/" + name, name, name + "/"));
		const roots = await Promise.all((this.config.roots ?? []).map((r) => count(r.path, r.name, `${r.name}:`)));
		const wechat: Array<{
			chat: string;
			messages: number;
			chars: number;
			tokens: number;
			lastSync: number | null;
			stale: boolean;
		}> = [];
		if (this.config.sources?.wechat?.chats?.length) {
			let lastSync: number | null = null;
			try {
				const value = await this.wechat.command(["status"], signal);
				lastSync = (value.last_sync as { at?: number })?.at ?? null;
			} catch {
				unestimated.push({ path: "wechat", reason: "archive status unavailable" });
			}
			for (const source of this.config.sources.wechat.chats) {
				const item = {
					chat: source.chat,
					messages: 0,
					chars: 0,
					tokens: 0,
					lastSync,
					stale:
						lastSync === null ||
						Date.now() - lastSync * 1000 > (this.config.bootstrap?.wechatStaleHours ?? 24) * 3600000,
				};
				try {
					for await (const m of this.wechat.history(source.chat, signal)) {
						const text = this.wechat.body(m);
						item.messages++;
						item.chars += text.length;
						item.tokens += countTokens(text, { disallowedSpecial: new Set() });
					}
				} catch {
					unestimated.push({ path: `wechat:${source.chat}`, reason: "archive history unavailable" });
				}
				wechat.push(item);
			}
		}
		const selected = model ?? this.config.bootstrap?.model,
			slash = selected?.indexOf("/") ?? -1;
		const price =
			selected && slash > 0
				? this.api.models.getModel(selected.slice(0, slash), selected.slice(slash + 1))?.cost.input
				: undefined;
		const all = [...zones, ...roots, ...wechat];
		const total = {
			files: [...zones, ...roots].reduce((s, c) => s + c.files, 0),
			chars: all.reduce((s, c) => s + c.chars, 0),
			tokens: all.reduce((s, c) => s + c.tokens, 0),
		};
		return {
			...(selected ? { model: selected } : {}),
			...(price === undefined ? {} : { inputUsdPerMTok: price }),
			total: { ...total, ...(price === undefined ? {} : { usd: (total.tokens * price) / 1e6 }) },
			zones,
			roots,
			wechat,
			unestimated,
		};
	}
	async tool(args: BootstrapArgs, ctx: ToolContext) {
		if (args.op === "audit") return this.audit(args.model, ctx.signal);
		if (args.op === "state") return this.state();
		const now = Date.now(),
			until = now + (args.snoozeDays ?? (this.config.bootstrap?.cooldownHours ?? 24) / 24) * 86400000;
		await this.store.edit(
			".memory/state.json",
			(old) => {
				const state: State = { acked: {}, lastEmitted: {}, audited: [], ...JSON.parse(old ?? "{}") };
				state.acked[args.reason!] = { at: new Date(now).toISOString(), until: new Date(until).toISOString() };
				if (args.reason === "first-run") state.initialized = new Date(now).toISOString();
				if (["first-run", "source-new"].includes(args.reason!))
					state.audited = [...new Set([...state.audited, ...this.sources()])];
				return JSON.stringify(state);
			},
			writeContext("memory_bootstrap.ack", ctx.signal),
		);
		return { path: ".memory/state.json", ids: [], ...(await this.state()) };
	}
	async check(emit: PluginAPI["events"]["emit"]) {
		await serial(this.config.root + "/.memory/bootstrap", async () => {
			const state = await this.state(),
				now = Date.now(),
				audit = await this.audit(undefined, this.lifetime.signal),
				backlog = await status(this.config, this.lifetime.signal, this.errors);
			const candidates: string[] = [];
			if (!state.initialized) candidates.push("first-run");
			if (this.sources().some((s) => !state.audited.includes(s))) candidates.push("source-new");
			if (audit.wechat.some((s) => s.stale && s.lastSync !== null)) candidates.push("source-stale");
			if (
				backlog.inbox >= (this.config.bootstrap?.inboxFiles ?? 20) ||
				backlog.unorganized >= (this.config.bootstrap?.unorganized ?? 100) ||
				(backlog.oldestAgeDays ?? 0) > (this.config.bootstrap?.staleDays ?? 7)
			)
				candidates.push("backlog");
			for (const reason of candidates) {
				if (
					Date.parse(state.acked[reason]?.until ?? "") > now ||
					now - Date.parse(state.lastEmitted[reason] ?? "1970-01-01") <
						(this.config.bootstrap?.cooldownHours ?? 24) * 3600000
				)
					continue;
				state.lastEmitted[reason] = new Date(now).toISOString();
				await this.store.edit(
					".memory/state.json",
					() => JSON.stringify(state),
					writeContext("memory.attention", this.lifetime.signal),
				);
				await emit({
					type: "memory.attention",
					from: "plugin:memory",
					conv: "conv:memory-bootstrap:default",
					data: { reason, audit },
				});
			}
		});
	}
	trigger(): Trigger {
		return {
			id: "memory-bootstrap",
			start: async (io) => {
				clearInterval(this.timer);
				await initialize(this.config.root);
				await this.check(io.emit);
				this.timer = setInterval(
					() => {
						this.work = this.work
							.then(() => this.check(io.emit))
							.catch(() => {
								this.errors.push("Bootstrap evaluation failed");
							});
					},
					(this.config.bootstrap?.checkMinutes ?? 60) * 60000,
				);
				this.timer.unref();
			},
			stop: async () => {
				clearInterval(this.timer);
				this.lifetime.abort();
				await this.work;
			},
		};
	}
}
