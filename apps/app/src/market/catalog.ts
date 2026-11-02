import type { Listing, ListingKind, MarketState } from "./types";

export const CHANNELS: { id: string; kind: ListingKind; label: string }[] = [
	{ id: "goods", kind: "item", label: "好物" },
	{ id: "services", kind: "service", label: "服务" },
	{ id: "ideas", kind: "idea", label: "创意" },
	{ id: "jobs", kind: "job", label: "招聘" },
	{ id: "requests", kind: "request", label: "求助" },
	{ id: "other", kind: "other", label: "其他" },
];
export const kindLabel = (kind: ListingKind) => CHANNELS.find((c) => c.kind === kind)?.label ?? "帖子";
export const hasListingImage = (image: string) => !!image && !image.startsWith("/market/");
export const priceLabel = (listing: Pick<Listing, "price" | "unit" | "kind">) =>
	listing.price > 0
		? `¥${listing.price.toLocaleString()}${listing.unit}`
		: listing.kind === "idea"
			? "一起聊聊"
			: "面议";
export const viewCount = (listing: Listing) => listing.metrics.agentViews + listing.metrics.humanViews;
export const compactCount = (value: number) =>
	value >= 10000 ? `${(value / 10000).toFixed(1).replace(/\.0$/, "")}万` : value.toLocaleString();

/**
 * Extend the previous local preview without replacing personal edits or collections.
 * 旧版本（v2 及以前）把整份帖子和 base64 图片一起写进 localStorage；帖子已改由云端接口提供，
 * 读取旧状态时直接丢弃 `listings` 字段（B4），只保留收藏、点赞、对比与咨询。
 * 旧版本也存在这里的 `tasks`（我的需求）已改由云端 watch_tasks 保存，读取时不再还原；
 * 未迁移的那几条由 market/store.ts 读取，迁移成功后写回时一并去掉。
 */
export function upgradeMarketState(
	saved: Partial<MarketState> & { listings?: unknown; tasks?: unknown },
	initial: MarketState,
): MarketState {
	if (!["saved", "compare", "inquiries"].every((k) => Array.isArray(saved[k as keyof MarketState]))) return initial;
	return {
		...initial,
		version: 3,
		saved: saved.saved ?? initial.saved,
		liked: Array.isArray(saved.liked) ? saved.liked : [],
		compare: saved.compare ?? initial.compare,
		inquiries: saved.inquiries ?? initial.inquiries,
	};
}
