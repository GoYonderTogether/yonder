export type ListingKind = "item" | "service" | "request" | "idea" | "job" | "other";
export type Category = "数码好物" | "生活方式" | "创意服务" | "技能与陪伴" | "户外出行";

export type ListingVisibility = "public" | "friends" | "private";
export interface Coordinates {
	latitude: number;
	longitude: number;
}

export interface Listing {
	sellerId?: string;
	visibility?: ListingVisibility;
	expiresAt?: number | null;
	coordinates?: Coordinates | null;
	id: string;
	kind: ListingKind;
	category: Category;
	title: string;
	description: string;
	price: number;
	unit: string;
	image: string;
	imagePosition?: string;
	seller: string;
	sellerRole: string;
	location: string;
	tags: string[];
	facts: { label: string; value: string }[];
	delivery: string;
	missing: string[];
	agent: boolean;
	discoverable?: boolean;
	mine?: boolean;
	paused?: boolean;
	createdAt: number;
	metricSource?: "sample";
	metrics: { agentViews: number; shortlists: number; humanViews: number; inquiries: number };
}

export interface SearchBrief {
	text: string;
	category: Category | "不限";
	budget: number;
	location: string;
	priority: "最合适" | "价格优先" | "同城优先";
	frequency: "每小时" | "每天" | "手动";
}

/** 页面里的需求视图：`SearchBrief` 用中文字段值，id 与云端 watch task 相同。 */
export interface AgentTask extends SearchBrief {
	id: string;
	title: string;
	active: boolean;
	checkedAt: number;
	seenIds: string[];
}

/** 云端 watch_tasks 的 brief（server/src/market.ts SearchBrief）：字段值用接口枚举。 */
export interface WatchBrief {
	text: string;
	category: Category | "any";
	budget: number;
	location: string;
	priority: "best" | "price" | "local";
}

export type WatchFrequency = "hourly" | "daily" | "manual";

/** 一条云端需求。`seenIds` / `checkedAt` 只由云端任务写入，网页只读。 */
export interface WatchTask {
	id: string;
	ownerId: string;
	title: string;
	brief: WatchBrief;
	frequency: WatchFrequency;
	active: boolean;
	botId?: string;
	checkedAt: number;
	seenIds: string[];
	createdAt: number;
}

export interface WatchTaskInput {
	title: string;
	brief: WatchBrief;
	frequency: WatchFrequency;
}

export interface WatchTaskUpdate {
	title?: string;
	brief?: WatchBrief;
	frequency?: WatchFrequency;
	active?: boolean;
}

/** 推荐理由只陈述可核对的事实（预算、同城、线上），不再计算相似度分数。 */
export interface Match {
	listing: Listing;
	reasons: string[];
	tradeoff: string;
}

export interface Inquiry {
	id: string;
	listingId: string;
	title: string;
	seller: string;
	body: string;
	createdAt: number;
	messages?: { id: string; body: string; createdAt: number }[];
}

export interface MarketState {
	version: number;
	saved: string[];
	liked: string[];
	compare: string[];
	inquiries: Inquiry[];
}
