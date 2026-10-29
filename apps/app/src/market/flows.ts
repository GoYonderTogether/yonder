import type { Inquiry, Listing } from "./types";

export interface MarketFilters {
	category: string;
	kind: string;
	city: string;
	min: string;
	max: string;
	sort: string;
}
export const defaultFilters: MarketFilters = {
	category: "全部",
	kind: "全部",
	city: "不限",
	min: "",
	max: "",
	sort: "综合排序",
};
export function filterListings(listings: Listing[], query: string, f: MarketFilters) {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const result = listings.filter(
		(l) =>
			!l.paused &&
			(f.category === "全部" || f.category === l.category) &&
			(f.kind === "全部" || f.kind === l.kind) &&
			(f.city === "不限" || f.city === l.location) &&
			(!f.min || l.price >= Number(f.min)) &&
			(!f.max || l.price <= Number(f.max)) &&
			words.every((word) =>
				`${l.title} ${l.description} ${l.tags.join(" ")} ${l.seller} ${l.location}`.toLowerCase().includes(word),
			),
	);
	if (f.sort === "最新") result.sort((a, b) => b.createdAt - a.createdAt);
	if (f.sort === "价格从低到高") result.sort((a, b) => a.price - b.price);
	if (f.sort === "价格从高到低") result.sort((a, b) => b.price - a.price);
	return result;
}
export function priceError(min: string, max: string) {
	if ([min, max].some((v) => v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0))) return "价格不能小于 0";
	if (min && max && Number(min) > Number(max)) return "最高价格不能低于最低价格";
	return "";
}
/** Older one-message inquiries become a conversation without discarding the original message. */
export function messagesFor(inquiry: Inquiry) {
	return inquiry.messages ?? [{ id: inquiry.id, body: inquiry.body, createdAt: inquiry.createdAt }];
}
export function normalizeInquiries(inquiries: Inquiry[]): Inquiry[] {
	const grouped = new Map<string, Inquiry>();
	for (const inquiry of inquiries) {
		const previous = grouped.get(inquiry.listingId);
		const messages = [
			...new Map([...(previous ? messagesFor(previous) : []), ...messagesFor(inquiry)].map((m) => [m.id, m])).values(),
		].sort((a, b) => a.createdAt - b.createdAt);
		const last = messages.at(-1);
		grouped.set(inquiry.listingId, {
			...inquiry,
			messages,
			body: last?.body ?? inquiry.body,
			createdAt: last?.createdAt ?? inquiry.createdAt,
		});
	}
	return [...grouped.values()].sort((a, b) => b.createdAt - a.createdAt);
}
export function appendMessage(
	inquiries: Inquiry[],
	listing: Listing,
	body: string,
	now: number,
	id: string,
): Inquiry[] {
	const existing = normalizeInquiries(inquiries).find((i) => i.listingId === listing.id);
	const message = { id, body: body.trim(), createdAt: now };
	const conversation: Inquiry = existing
		? { ...existing, body: message.body, createdAt: now, messages: [...messagesFor(existing), message] }
		: {
				id,
				listingId: listing.id,
				title: listing.title,
				seller: listing.seller,
				body: message.body,
				createdAt: now,
				messages: [message],
			};
	return [conversation, ...inquiries.filter((i) => i.listingId !== listing.id)];
}
