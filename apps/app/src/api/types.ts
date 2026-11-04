// API 契约：前端只依赖这里的类型与 client.ts 的 ApiClient 接口。
// 后端 / API 层实现 ApiClient 即可替换 mock.ts，页面不用改。

export type ActorKind = "human" | "agent";

export interface Actor {
	id: string;
	/** Stable public reference; UUID id remains the internal API identity. */
	code?: string;
	kind: ActorKind;
	name: string;
	/** Cloud-hosted HTTPS image URL; absent uses the default identity mark. */
	avatarUrl?: string;
	/** 人：是否匿名访客。agent：所属主人 */
	anonymous?: boolean;
	ownerId?: string;
	/** 仅 agent：运行在哪台设备上 */
	deviceId?: string;
	/** 仅 agent：是否在线 */
	online?: boolean;
	/** 已发布名片时为真 */
	hasCard?: boolean;
	public?: boolean;
	summary?: string | null;
	note?: string;
	/** 当前账号绑定的登录手机号/邮箱；只在本人会话的 actor 上返回，公开资料不带 */
	phone?: string | null;
	email?: string | null;
}

export type MessageContent =
	| { type: "text"; text: string; mentions?: string[]; mentionAll?: boolean }
	| { type: "markdown"; text: string; mentions?: string[]; mentionAll?: boolean }
	| { type: "error"; text: string }
	| { type: "image"; url: string; name?: string }
	| { type: "file"; url: string; name: string; bytes?: number }
	| {
			type: "interactive";
			title: string;
			body: string;
			actions: { id: string; label: string; link?: string }[];
			state: "pending" | "done";
			link?: string;
	  };

export interface Message {
	id: string;
	convId: string;
	seq: number;
	senderId: string;
	content: MessageContent;
	replyTo?: string;
	createdAt: number;
}

export type ConversationKind = "dm" | "group" | "notice";

export interface Conversation {
	avatarUrl?: string | null;
	mentionUnread?: boolean;
	selfMutedUntil?: number | null;
	id: string;
	/** Stable public reference; UUID id remains the internal API identity. */
	code?: string;
	kind: ConversationKind;
	title: string;
	members?: { accountId: string; role: "owner" | "admin" | "member" }[];
	memberIds: string[];
	unread: number;
	last?: Message;
}

export interface CardDisplay {
	kind: "html" | "svg";
	source: string;
}

/**
 * 名片背面与详情的可选资料块（后端 face.profile）：只承载用户填写的真实内容，
 * 字段缺省就不渲染对应区块。
 */
export interface CardProfile {
	/** 头衔，如「YonderAI 联合创始人」 */
	title?: string;
	/** 名字旁的小字，如英文别名 */
	alias?: string;
	/** 背面 k/v 行，最多 6 条 */
	facts?: { k: string; v: string }[];
	/** 背面「在找」一行 */
	seeking?: string;
	/** 「详情」展开的介绍 */
	intro?: string;
}

/** 卡面结构（card-form.md §8），全部可选；只有名字必须。 */
export interface CardVisibility {
	shop?: boolean;
	signature: boolean;
	code: boolean;
	greeting: boolean;
}

export interface ProfileUpdateInput {
	name: string;
	avatarUrl: string | null;
	tagline: string;
	markdown: string;
	coverUrl: string | null;
	visibility: CardVisibility;
	/** 默认卡片的卡面扩展（profile 资料、标签）；省略时后端保留原值 */
	face?: Pick<CardFace, "profile" | "tags">;
}

export interface ProfileUpdateResult {
	actor: Actor;
	card: Card;
}

export interface CardFace {
	coverUrl?: string | null;
	visibility?: CardVisibility;
	theme: "mist" | "night" | "paper" | "ink";
	/** 名片页纸卡上的资料：头衔、别名、背面事实、在找、介绍 */
	profile?: CardProfile;
	headline?: string;
	tags?: string[];
	section?: { title: string; body: string };
	sticker?: { url: string; frame: "stamp" | "round" | "none" };
}

export type CardKind = "default" | "persona" | "agent";
export type CardSource = "scan" | "link" | "chat";

export interface Card {
	id: string;
	/** Stable public reference; UUID id remains the internal API identity. */
	code?: string;
	/** default = 注册即有、已发布、不可删的加好友名片 */
	kind: CardKind;
	face?: CardFace;
	/** 仅收到的名片 */
	/** epoch 毫秒 */
	collectedAt?: number;
	source?: CardSource;
	/** 名片属于谁：我，或我的某个 Agent */
	ownerId: string;
	/** 访客点“和 TA 聊天”时对话的对象：Agent 或用户 */
	respondentId: string;
	/** 卡包里的名字，如“给投资人” */
	title: string;
	/** 一句话，卡包里显示 */
	tagline?: string | null;
	summary: string | null;
	/** 是我的名片（可编辑）还是收到的 */
	mine: boolean;
	markdown: string;
	display?: CardDisplay;
	status: "draft" | "published";
	publishedEver?: boolean;
	rev: number;
	updatedAt: number;
}

export interface Session {
	actor: Actor;
	/** 匿名访客的剩余发言额度（额度为 0 即不限时不下发）。 */
	guest?: { max: number; remaining: number };
}

/** `harness` = an external harness connector registered as a device (spec 16 §5, 23). */
export type DeviceKind = "laptop" | "desktop" | "server" | "cloud" | "harness";

/** The executor identity a device reported over its authenticated inbox relay (spec 18 §5). */
export interface DeviceExecutor {
	deviceId: string;
	publicKey: string;
}

/** 运行 Yonder 的一台电脑。 */
export interface Device {
	id: string;
	/** Stable public reference; UUID id remains the internal API identity. */
	code?: string;
	name: string;
	kind: DeviceKind;
	/** 当前正在用的这台 */
	current?: boolean;
	online: boolean;
	workProtocol?: 1;
	/** Present only after that device's executor reported its own identity. */
	executor?: DeviceExecutor;
	/** ISO time of the last completed device hello; absent when it never connected. */
	lastSeenAt?: string;
	/** ISO time of the newest message this device's own Bots sent; absent when it never sent one. */
	lastActiveAt?: string;
}

/** One grant summary the executor reported, shown back to its owner (spec 19 §10). */
export interface DeviceGrant {
	grantId: string;
	/** Hex SHA-256 of the controller's public key. */
	principalId: string;
	botId: string | null;
	botLabel: string | null;
	source: "cloud" | "manual";
	capabilities: string[];
	targetIds: string[];
	readRoots: string[];
	writeRoots: string[];
	revision: number;
	issuedAt: string;
	expiresAt: string;
	revokedAt: string | null;
}

/** `observed:false` means the device never reported; it is not "no grants". */
export interface DeviceGrants {
	observed: boolean;
	grants: DeviceGrant[];
}

/** A Bot's effective device set (spec 19 §9). Not an authorization source. */
export interface BotDevices {
	botId: string;
	mode: "all" | "selected";
	devices: { id: string; code?: string; name: string; kind: DeviceKind; online: boolean }[];
	allowed: string[];
}

export interface Profile {
	actor: Actor;
	summary: string | null;
	card: Pick<Card, "id" | "code" | "markdown" | "display" | "tagline" | "summary" | "face"> | null;
	agents: Actor[];
	owner: Actor | null;
}

export interface ConversationDetail {
	selfNickname?: string | null;
	avatarUrl?: string | null;
	selfRole?: "owner" | "admin" | "member";
	selfMutedUntil?: number | null;
	pinnedMessages?: Message[];
	announcement?: Message | null;
	id: string;
	/** Stable public reference; UUID id remains the internal API identity. */
	code?: string;
	kind: ConversationKind;
	title: string;
	members: (Actor & { role?: "owner" | "admin" | "member"; mutedUntil?: number | null; nickname?: string | null })[];
}

export interface GroupPreview {
	title: string;
	memberCount: number;
	members: Actor[];
	member: boolean;
	convId?: string;
	convCode?: string;
}

export type ReferenceKind = "actor" | "card" | "conversation" | "device";
export interface ResolvedReference {
	id: string;
	code: string;
}

/** 验证码登录的两种方式：手机短信、邮箱；首次验证即注册，不设密码。 */
export type VerifyKind = "phone" | "email";

/** POST /api/auth/code/send 的入参；shareToken 只有从分享链接进来时才有。 */
export interface CodeSendInput {
	kind: VerifyKind;
	target: string;
	shareToken?: string;
}

/** 发送结果；retryAfter 是服务端给出的重发冷却秒数。 */
export interface CodeSent {
	sent: true;
	retryAfter: number;
}

/** POST /api/auth/code/verify 的入参；name 只给首次注册时用。 */
export interface CodeVerifyInput {
	kind: VerifyKind;
	target: string;
	code: string;
	shareToken?: string;
	name?: string;
}

export type ShareLinkKind = "card" | "group";

/**
 * 分享链接配额（POST /api/share-links）：每次生成名片/群链接时服务端建一条记录，
 * 计数只算凭这条链接成功验证的新访客。url 是服务端用 PUBLIC_ORIGIN 拼的 `/?share=<token>`。
 */
export interface ShareLink {
	token: string;
	kind: ShareLinkKind;
	targetId: string;
	maxUses: number;
	usedCount: number;
	/** ISO 时间 */
	expiresAt: string;
	/** ISO 时间；未吊销为 null */
	revokedAt: string | null;
	/** 服务端拼好的分享地址；个别响应不带时为 undefined，调用方需自行拼接 */
	url?: string;
}
