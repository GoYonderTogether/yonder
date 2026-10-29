import type { Listing, ListingKind, MarketState } from "./types";

export const CHANNELS: { id: string; kind: ListingKind; label: string }[] = [
	{ id: "goods", kind: "item", label: "好物" },
	{ id: "services", kind: "service", label: "服务" },
	{ id: "ideas", kind: "idea", label: "创意" },
	{ id: "jobs", kind: "job", label: "招聘" },
	{ id: "requests", kind: "request", label: "求助" },
];
export const kindLabel = (kind: ListingKind) => CHANNELS.find((c) => c.kind === kind)?.label ?? "帖子";
export const priceLabel = (listing: Pick<Listing, "price" | "unit" | "kind">) =>
	listing.price > 0
		? `¥${listing.price.toLocaleString()}${listing.unit}`
		: listing.kind === "idea"
			? "一起聊聊"
			: "面议";
export const viewCount = (listing: Listing) => listing.metrics.agentViews + listing.metrics.humanViews;
export const compactCount = (value: number) =>
	value >= 10000 ? `${(value / 10000).toFixed(1).replace(/\.0$/, "")}万` : value.toLocaleString();

/** Extend the previous local preview without replacing personal edits or collections. */
export function upgradeMarketState(saved: Partial<MarketState>, initial: MarketState): MarketState {
	if (
		!["listings", "tasks", "saved", "compare", "inquiries"].every((k) => Array.isArray(saved[k as keyof MarketState]))
	)
		return initial;
	const seedIds = new Set(initial.listings.map((l) => l.id));
	const listings = saved.listings!.map((l) => (seedIds.has(l.id) ? { ...l, metricSource: "sample" as const } : l));
	if ((saved.version ?? 1) < 2) {
		const ids = new Set(listings.map((l) => l.id));
		listings.splice(2, 0, ...initial.listings.filter((l) => (l.kind === "idea" || l.kind === "job") && !ids.has(l.id)));
	}
	return { ...initial, ...saved, version: 2, listings, liked: Array.isArray(saved.liked) ? saved.liked : [] };
}
