import type { PluginAPI, ViewContent, ViewData } from "@yonder/sdk";
import type { MarketClient } from "./client.js";
import type { Frequency, WatchRunner } from "./watch.js";

const CACHE = 15000;

const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const items = (body: unknown): Array<Record<string, unknown>> => {
	const outer = record(body);
	return (Array.isArray(outer.items) ? outer.items : []).map(record);
};

const text = (value: unknown, fallback: string): string => (typeof value === "string" && value ? value : fallback);

const markdown = (value: string): ViewContent => ({ type: "markdown", text: value });

const frequencyLabel: Record<Frequency, string> = { hourly: "每小时", daily: "每天", manual: "仅手动" };

/** `market.panel`：我的发布、收到的询问（未读数）、找东西任务。数据全部来自 19.4，不另设后端。 */
export function registerMarketView(
	api: PluginAPI,
	deps: { client(): Promise<MarketClient | undefined>; watch: WatchRunner },
): void {
	let cached: { at: number; data: ViewData } | undefined;
	api.views.register(
		{ id: "market.panel", plugin: api.id, title: "Market", placement: "rail", scope: "session" },
		{
			async data(): Promise<ViewData> {
				if (cached && Date.now() - cached.at < CACHE) return cached.data;
				const at = Date.now();
				const content = await render(deps);
				const data = { ...content, rev: at };
				cached = { at, data };
				return data;
			},
		},
	);
}

async function render(deps: {
	client(): Promise<MarketClient | undefined>;
	watch: WatchRunner;
}): Promise<Omit<ViewData, "rev">> {
	const client = await deps.client();
	if (!client)
		return {
			viewId: "market.panel",
			content: markdown("未登录社交云端：在 `yonder.yaml` 的 `market` 配置里给出设备令牌凭据名（默认 `market`）。"),
		};
	const [mine, inquiries, tasks] = await Promise.all([
		client.call({ method: "GET", path: "/listings", query: { mine: 1, limit: 20 } }),
		client.call({ method: "GET", path: "/inquiries", query: { role: "seller", limit: 20 } }),
		client.call({ method: "GET", path: "/watch-tasks", query: { limit: 20 } }),
	]);
	const failed = [mine, inquiries, tasks].find((result) => !result.ok);
	if (failed && !failed.ok) return { viewId: "market.panel", content: markdown(`市场云端返回 ${failed.error}。`) };
	const listings = mine.ok ? items(mine.body) : [];
	const threads = inquiries.ok ? items(inquiries.body) : [];
	const watching = tasks.ok ? items(tasks.body) : [];
	const unread = threads.reduce((sum, item) => sum + (typeof item.unread === "number" ? item.unread : 0), 0);
	const scheduled = new Map((await deps.watch.snapshot()).map((entry) => [entry.id, entry.nextAt]));
	return {
		viewId: "market.panel",
		content: {
			type: "list",
			items: [
				...listings.map((item) => ({
					id: `listing:${String(item.id)}`,
					title: text(item.title, "(无标题)"),
					subtitle: `我的发布 · ${text(item.status, "active")} · ¥${String(item.price ?? "-")}`,
				})),
				...threads.map((item) => ({
					id: `inquiry:${String(item.id)}`,
					title: text(item.title, "(无标题)"),
					subtitle: `收到的询问 · 未读 ${String(item.unread ?? 0)}`,
					state: (typeof item.unread === "number" && item.unread > 0 ? "doing" : "info") as "doing" | "info",
				})),
				...watching.map((item) => {
					const id = String(item.id);
					const next = scheduled.get(id);
					return {
						id: `watch:${id}`,
						title: text(item.title, id),
						subtitle: `找东西 · ${frequencyLabel[frequencyOf(item.frequency)]} · ${
							item.active === false
								? "已停用"
								: next
									? `下次 ${new Date(next).toISOString().slice(0, 16).replace("T", " ")}`
									: "未排程"
						}`,
					};
				}),
			],
		},
		...(unread > 0 ? { badge: unread } : {}),
	};
}

const frequencyOf = (value: unknown): Frequency => (value === "hourly" || value === "daily" ? value : "manual");
