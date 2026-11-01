import type { ListingInput } from "../api/client";
import type { Coordinates, Listing } from "./types";

export type ShopTab = "active" | "paused" | "expired";
export const VISIBILITY_LABEL = { public: "所有人", friends: "仅好友", private: "仅自己" } as const;
export function isExpired(listing: Pick<Listing, "expiresAt">, now = Date.now()) {
	return typeof listing.expiresAt === "number" && listing.expiresAt <= now;
}
export function listingTab(listing: Pick<Listing, "paused" | "expiresAt">, now = Date.now()): ShopTab {
	return listing.paused ? "paused" : isExpired(listing, now) ? "expired" : "active";
}
export function selectedExpiry(duration: string, previous?: number | null, now = Date.now()) {
	if (duration === "keep") return previous ?? null;
	if (duration === "forever") return null;
	const days = Number(duration);
	if (![1, 3, 7, 30].includes(days)) throw new Error("请选择有效期");
	return now + days * 86400_000;
}
export function approximateCoordinates(latitude: number, longitude: number): Coordinates {
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
		throw new Error("定位结果无效，请重试");
	return { latitude: Math.round(latitude * 1000) / 1000, longitude: Math.round(longitude * 1000) / 1000 };
}
export const locationLabel = (listing: Pick<Listing, "location" | "coordinates">) =>
	listing.location.trim() || (listing.coordinates ? "已附定位" : "未附地点 / 线上");
export function listingInput(listing: Listing, previous?: Listing): ListingInput {
	return {
		kind: listing.kind,
		category: listing.category,
		title: listing.title,
		description: listing.description,
		price: listing.price,
		unit: listing.unit,
		location: listing.location,
		delivery: listing.delivery,
		images: listing.image ? [listing.image] : [],
		sellerRole: listing.sellerRole,
		discoverable: listing.discoverable !== false,
		agent: listing.agent,
		tags: listing.tags,
		facts: listing.facts,
		missing: listing.missing,
		visibility: listing.visibility ?? "public",
		...(previous && (previous.expiresAt ?? null) === (listing.expiresAt ?? null)
			? {}
			: { expiresAt: listing.expiresAt ?? null }),
		coordinates: listing.coordinates ?? null,
	};
}
export function marketError(error: unknown) {
	const code = error instanceof Error ? error.message : "";
	return (
		(
			{
				not_found: "帖子不存在或当前不可访问，请刷新后重试。",
				forbidden: "你没有操作此发布的权限。",
				invalid_request: "发布信息有误，请检查后重试。",
				expired: "发布已到期，请先编辑有效期。",
				unauthorized: "请登录后继续。",
			} as Record<string, string>
		)[code] ?? (code && !/^[a-z_]+$/.test(code) ? code : "操作失败，请稍后重试。")
	);
}
