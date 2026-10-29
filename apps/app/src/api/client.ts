import type { Category, Listing, ListingKind } from "../market/types";
import type {
	Actor,
	Card,
	CodeSendInput,
	CodeSent,
	CodeVerifyInput,
	Conversation,
	ConversationDetail,
	Device,
	DeviceKind,
	GroupPreview,
	Message,
	MessageContent,
	Profile,
	ReferenceKind,
	ResolvedReference,
	Session,
	ShareLink,
	ShareLinkKind,
	VerifyKind,
} from "./types";

/** 云端 POST/PATCH 可写的帖子字段（与 server/src/market.ts listingInput 对齐）。 */
export interface ListingInput {
	kind: ListingKind;
	category: Category;
	title: string;
	description: string;
	price: number;
	unit: string;
	location: string;
	delivery: string;
	images: string[];
	sellerRole: string;
	discoverable: boolean;
	agent: boolean;
	tags: string[];
	facts: { label: string; value: string }[];
	missing: string[];
}

/**
 * 后端接口契约。每个方法对应 server/PLAN.md 中的一项接口能力。
 * 实时消息用 subscribe：返回取消订阅函数。
 */
export interface ApiClient {
	resolve(kind: ReferenceKind, reference: string): Promise<ResolvedReference | null>;
	// 账号（邮箱 + 密码，不验证邮箱）
	session(): Promise<Session | null>;
	/** 发送短信/邮箱验证码；访客从分享链接进来时带 shareToken。冷却中 429，发送失败 502。 */
	sendCode(input: CodeSendInput): Promise<CodeSent>;
	/** 校验验证码并登录；首次验证即注册，Set-Cookie 后返回当前身份。 */
	verifyCode(input: CodeVerifyInput): Promise<Session>;
	/** 给已登录账号绑定/换绑手机号或邮箱：先发码，再 confirm；成功后服务端撤销所有会话。 */
	sendBindCode(kind: VerifyKind, target: string): Promise<CodeSent>;
	confirmBindCode(kind: VerifyKind, target: string, code: string): Promise<void>;
	register(input: { email: string; password: string; name: string }): Promise<Session>;
	login(input: { email: string; password: string }): Promise<Session>;
	/** 访客点“和 TA 聊天”时创建匿名账号 */
	createAnonymous(): Promise<Session>;
	logout(): Promise<void>;
	updateProfile(input: { name: string }): Promise<Actor>;

	// 聊天
	actors(ids: string[]): Promise<Actor[]>;
	conversations(): Promise<Conversation[]>;
	messages(convId: string): Promise<Message[]>;
	send(convId: string, content: MessageContent, replyTo?: string): Promise<Message>;
	/** 与某个账号开私聊，已存在则返回原会话 */
	openDm(actorId: string): Promise<Conversation>;
	/** 名片页「开始聊天」：开私聊 + 加好友 + 收名片，幂等 */
	startFromCard(cardId: string, source?: NonNullable<Card["source"]>): Promise<Conversation>;
	/** 当前身份与该名片对象已有的会话；没有返回 null */
	cardConversation(cardId: string): Promise<{ convId: string } | null>;
	createGroup(input: { title: string; memberIds: string[] }): Promise<Conversation>;
	conversationDetail(convId: string): Promise<ConversationDetail>;
	groupInvite(convId: string): Promise<{ token: string }>;
	groupPreview(token: string): Promise<GroupPreview | null>;
	joinGroup(token: string, share?: string): Promise<Conversation>;
	/** 生成（或复用未过期的）名片/群分享链接；匿名访客不能生成，服务端返回 403 */
	createShareLink(input: {
		kind: ShareLinkKind;
		targetId: string;
		maxUses?: number;
		expiresAt?: string;
	}): Promise<ShareLink>;
	/** 查一条分享链接的配额；不存在或不属于当前账号返回 null */
	getShareLink(token: string): Promise<ShareLink | null>;
	/** 吊销分享链接；已经吊销过的保持原吊销时间 */
	revokeShareLink(token: string): Promise<void>;
	shareLinkStatus(
		token: string,
	): Promise<{ state: "active" | "share_exhausted" | "share_expired" | "share_revoked" } | null>;
	leaveConversation(convId: string): Promise<void>;
	markRead(convId: string, seq: number): Promise<void>;
	subscribe(listener: (m: Message) => void): () => void;

	// 名片：卡包里有多张，我的（Agent 与分身）和收到的
	cards(): Promise<Card[]>;
	card(cardId: string): Promise<Card | null>;
	/** 新建一张我的分身名片草稿 */
	createCard(): Promise<Card>;
	saveDraft(
		cardId: string,
		input: { title: string; tagline?: string; markdown: string; display?: Card["display"]; face?: Card["face"] },
	): Promise<Card>;
	/** 只有人的令牌能发布 */
	publish(cardId: string): Promise<Card>;
	deleteCard(cardId: string): Promise<void>;
	collectCard(cardId: string, source?: NonNullable<Card["source"]>): Promise<void>;
	addFriend(accountId: string): Promise<void>;
	profile(accountId: string): Promise<Profile | null>;
	setAgentPublic(agentId: string, isPublic: boolean): Promise<Actor>;

	// 设备授权
	/** 连接页显示是哪台设备在请求授权 */
	deviceCode(code: string): Promise<{ name: string; kind: DeviceKind; status: string }>;
	confirmDevice(code: string): Promise<void>;

	// 设备：Yonder 所在的电脑。多设备部署插件接入前，只有本机
	devices(): Promise<Device[]>;
	createInvite(): Promise<{ code: string; expiresAt: string }>;
	renameDevice(deviceId: string, name: string): Promise<Device>;
	/** 一次开关某台设备上全部 Agent 的联网 */
	setDeviceOnline(deviceId: string, online: boolean): Promise<Device>;

	// 联系人：Yonder 接入的全部 Agent 自动出现，不需要手动连接
	contacts(): Promise<Actor[]>;
	/** 开关某个 Agent 的联网（关闭后它不再接收平台消息） */
	setAgentOnline(agentId: string, online: boolean): Promise<Actor>;
	/** 新建云端 Bot：只需名字，模型与预设等用服务端默认值。 */
	createBot(input: { name: string }): Promise<Actor>;
	/**
	 * 幂等：账号没有任何自己的 Bot 时由服务端创建默认 Bot（小歪 / Yonder Bot）并开好会话；已有则原样返回已有的。
	 * 服务端在账号行锁内判断，重复登录与并发请求不会产生多个。
	 */
	ensureDefaultBot(input: { name: string; englishName: string }): Promise<Actor>;

	// 市场：云端帖子。列表含他人公开帖与自己的全部帖（含已下架）。
	marketListings(): Promise<Listing[]>;
	/** 发布新帖；图片只接受 https 外链或内置 `/market/*.jpg`。 */
	createListing(input: ListingInput): Promise<Listing>;
	/** 修改帖子（kind 不可改）。 */
	updateListing(id: string, input: Partial<Omit<ListingInput, "kind">>): Promise<Listing>;
	/** 下架（paused）或重新上架（active）。 */
	setListingPaused(id: string, paused: boolean): Promise<Listing>;
}
