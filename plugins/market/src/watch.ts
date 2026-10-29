import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginAPI } from "@yonder/sdk";
import type { MarketClient } from "./client.js";

export type Frequency = "hourly" | "daily" | "manual";

/** 本插件排程状态；「是否已提示」的唯一状态在云端（seenIds），这里只管下一次何时调用 check。 */
export interface WatchEntry {
	id: string;
	title: string;
	frequency: Frequency;
	active: boolean;
	nextAt: number;
	agent: string | null;
}

const INTERVAL: Record<Frequency, number> = { hourly: 60 * 60 * 1000, daily: 24 * 60 * 60 * 1000, manual: 0 };
const TICK = 60 * 1000;
const NOTIFIED_LIMIT = 500;

const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const frequencyOf = (value: unknown): Frequency => (value === "hourly" || value === "daily" ? value : "manual");

/** 卡片正文：标题 + 每条 title/price/location/链接线索（云端页面路由尚未定义，用 id 指代）。 */
function card(entry: WatchEntry, items: Array<Record<string, unknown>>): string {
	const lines = items.map((item) => {
		const price =
			typeof item.price === "number" ? `¥${item.price}${typeof item.unit === "string" ? item.unit : ""}` : "价格未标";
		const place = typeof item.location === "string" && item.location ? item.location : "地点未标";
		const title = typeof item.title === "string" ? item.title : "(无标题)";
		return `- ${title} · ${price} · ${place} · id=${String(item.id ?? "")}`;
	});
	return [`市场找东西「${entry.title}」有 ${items.length} 条新匹配：`, ...lines].join("\n");
}

export class WatchRunner {
	private readonly entries = new Map<string, WatchEntry>();
	private readonly pending = new Set<string>();
	private readonly notified = new Set<string>();
	private loaded: Promise<void> | undefined;
	private writing: Promise<void> = Promise.resolve();
	private timer: ReturnType<typeof setInterval> | undefined;
	private warned = false;

	constructor(
		private readonly api: PluginAPI,
		private readonly client: () => Promise<MarketClient | undefined>,
	) {}

	private get file(): string {
		return join(this.api.paths.data, "watch.json");
	}

	async start(): Promise<void> {
		await this.load();
		this.timer ??= setInterval(() => void this.tick(), TICK).unref();
	}

	async stop(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	private load(): Promise<void> {
		this.loaded ??= (async () => {
			try {
				const parsed = record(JSON.parse(await readFile(this.file, "utf8")));
				const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
				for (const task of tasks) {
					const entry = record(task);
					if (typeof entry.id !== "string" || !entry.id) continue;
					this.entries.set(entry.id, {
						id: entry.id,
						title: typeof entry.title === "string" ? entry.title : entry.id,
						frequency: frequencyOf(entry.frequency),
						active: entry.active !== false,
						nextAt: typeof entry.nextAt === "number" ? entry.nextAt : Date.now(),
						agent: typeof entry.agent === "string" ? entry.agent : null,
					});
				}
			} catch {
				// 首次运行或文件损坏：以云端为准重建，不保留猜测。
			}
		})();
		return this.loaded;
	}

	private persist(): Promise<void> {
		const snapshot = { tasks: [...this.entries.values()] };
		this.writing = this.writing
			.then(async () => {
				await mkdir(this.api.paths.data, { recursive: true });
				await writeFile(this.file, `${JSON.stringify(snapshot, null, "\t")}\n`, "utf8");
			})
			.catch((error: unknown) => this.api.log.error("market watch state write failed", { error: String(error) }));
		return this.writing;
	}

	/** 单个任务落盘（工具 create/update 后调用）。 */
	async apply(task: unknown, agent: string | null): Promise<void> {
		await this.load();
		const item = record(task);
		if (typeof item.id !== "string" || !item.id) return;
		const frequency = frequencyOf(item.frequency);
		const active = item.active !== false;
		const previous = this.entries.get(item.id);
		const interval = INTERVAL[frequency];
		const checkedAt = typeof item.checkedAt === "number" ? item.checkedAt : undefined;
		const baseline = checkedAt === undefined ? Date.now() : Math.max(Date.now(), checkedAt + interval);
		this.entries.set(item.id, {
			id: item.id,
			title: typeof item.title === "string" && item.title ? item.title : item.id,
			frequency,
			active,
			nextAt: previous?.frequency === frequency && previous.nextAt > Date.now() ? previous.nextAt : baseline,
			agent: agent ?? previous?.agent ?? null,
		});
		if (!active || interval === 0) this.entries.delete(item.id);
		await this.persist();
	}

	/** 以云端列表为准重建缺失作业（D4：云端与本地不一致时以云端为准）。 */
	async reconcile(tasks: unknown[], agent: string | null): Promise<void> {
		await this.load();
		const now = Date.now();
		const seen = new Set<string>();
		for (const task of tasks) {
			const item = record(task);
			if (typeof item.id !== "string" || !item.id) continue;
			seen.add(item.id);
			const frequency = frequencyOf(item.frequency);
			if (item.active === false || frequency === "manual") continue;
			const previous = this.entries.get(item.id);
			const checkedAt = typeof item.checkedAt === "number" ? item.checkedAt : undefined;
			this.entries.set(item.id, {
				id: item.id,
				title: typeof item.title === "string" && item.title ? item.title : item.id,
				frequency,
				active: true,
				nextAt:
					previous?.nextAt ?? (checkedAt === undefined ? now + INTERVAL[frequency] : checkedAt + INTERVAL[frequency]),
				agent: agent ?? previous?.agent ?? null,
			});
		}
		for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.entries.delete(id);
		await this.persist();
	}

	async remove(id: string): Promise<void> {
		await this.load();
		this.entries.delete(id);
		await this.persist();
	}

	/** 手动 check 后顺延下一个排程点，避免同一分钟内重复调用。 */
	async checked(id: string): Promise<void> {
		await this.load();
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.nextAt = Date.now() + INTERVAL[entry.frequency];
		await this.persist();
	}

	/** views 面板用：本地排程快照。 */
	async snapshot(): Promise<WatchEntry[]> {
		await this.load();
		return [...this.entries.values()].map((entry) => ({ ...entry }));
	}

	async tick(now = Date.now()): Promise<void> {
		await this.load();
		const due = [...this.entries.values()].filter((entry) => entry.active && entry.nextAt <= now);
		if (!due.length) return;
		const client = await this.client();
		if (!client) {
			if (!this.warned) {
				this.warned = true;
				this.api.log.warn("market watch tasks are due but no cloud credential is configured");
			}
			return;
		}
		this.warned = false;
		for (const entry of due) await this.run(entry, client);
	}

	private async run(entry: WatchEntry, client: MarketClient): Promise<void> {
		if (this.pending.has(entry.id)) return;
		this.pending.add(entry.id);
		try {
			const result = await client.call({ method: "POST", path: `/watch-tasks/${encodeURIComponent(entry.id)}/check` });
			if (!result.ok) {
				this.api.log.warn("market watch check failed", { task: entry.id, error: result.error });
				return;
			}
			const body = record(result.body);
			const items = (Array.isArray(body.items) ? body.items : []).map(record);
			const fresh = items.filter((item) => {
				const key = `${entry.id}:${String(item.id ?? "")}`;
				if (!item.id || this.notified.has(key)) return false;
				this.notified.add(key);
				return true;
			});
			if (this.notified.size > NOTIFIED_LIMIT) this.notified.clear();
			if (fresh.length) await this.announce(entry, fresh);
		} catch (error) {
			this.api.log.error("market watch check threw", { task: entry.id, error: String(error) });
		} finally {
			this.pending.delete(entry.id);
			const next = this.entries.get(entry.id);
			if (next) {
				next.nextAt = Date.now() + INTERVAL[next.frequency];
				await this.persist();
			}
		}
	}

	/** 只通知主人：写入创建者 Agent 的开着的主对话，不联系卖家、不回复帖子。 */
	private async announce(entry: WatchEntry, items: Array<Record<string, unknown>>): Promise<void> {
		if (!entry.agent) {
			this.api.log.warn("market watch matches have no owning agent to notify", { task: entry.id });
			return;
		}
		const open = await this.api.sessions.list({ agent: entry.agent, mode: "main", open: true });
		const target = open[0];
		if (!target) {
			this.api.log.warn("market watch matches cannot be delivered: no open main session", { agent: entry.agent });
			return;
		}
		await this.api.sessions.notify(target.id, { event: "market.watch-matches", text: card(entry, items) });
	}
}
