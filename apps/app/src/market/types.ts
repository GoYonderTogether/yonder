export type ListingKind = "item" | "service" | "request" | "idea" | "job" | "other";
export type Category = "数码好物" | "生活方式" | "创意服务" | "技能与陪伴" | "户外出行";

export interface Listing {
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

export interface AgentTask extends SearchBrief {
	id: string;
	title: string;
	active: boolean;
	checkedAt: number;
	seenIds: string[];
}

export interface Match {
	listing: Listing;
	score: number;
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
	tasks: AgentTask[];
	saved: string[];
	liked: string[];
	compare: string[];
	inquiries: Inquiry[];
}
