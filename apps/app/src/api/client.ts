import type {
	Actor,
	BotDevices,
	Card,
	CodeSendInput,
	CodeSent,
	CodeVerifyInput,
	Conversation,
	ConversationDetail,
	Device,
	DeviceGrants,
	DeviceKind,
	GroupPreview,
	MainBot,
	MemoryDocument,
	MemoryDocuments,
	MemoryPage,
	Message,
	MessageContent,
	Profile,
	ProfileUpdateInput,
	ProfileUpdateResult,
	ReferenceKind,
	ResolvedReference,
	Session,
	ShareLink,
	ShareLinkKind,
	VerifyKind,
} from "./types";

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
	saveProfile(input: ProfileUpdateInput): Promise<ProfileUpdateResult>;

	// 聊天
	actors(ids: string[]): Promise<Actor[]>;
	conversations(): Promise<Conversation[]>;
	messages(convId: string, page?: { before?: number; since?: number; limit: number }): Promise<Message[]>;
	send(convId: string, content: MessageContent, replyTo?: string): Promise<Message>;
	/** 与某个账号开私聊，已存在则返回原会话 */
	openDm(actorId: string): Promise<Conversation>;
	/** 名片页「开始聊天」：开私聊 + 加好友 + 收名片，幂等 */
	startFromCard(cardId: string, source?: NonNullable<Card["source"]>): Promise<Conversation>;
	/** 当前身份与该名片对象已有的会话；没有返回 null */
	cardConversation(cardId: string): Promise<{ convId: string } | null>;
	createGroup(input: { title: string; memberIds: string[] }): Promise<Conversation>;
	conversationDetail(convId: string): Promise<ConversationDetail>;
	renameGroup(convId: string, title: string): Promise<void>;
	setGroupRole(convId: string, accountId: string, role: "owner" | "admin" | "member"): Promise<void>;
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
	subscribe(listener: (m: Message) => void, onReconnect?: () => void): () => void;

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

	// 设备：Yonder 所在的电脑，含云端运行时与外部 harness 连接器（kind='harness'）
	devices(): Promise<Device[]>;
	removeDevice(deviceId: string): Promise<void>;
	createInvite(): Promise<{ code: string; expiresAt: string }>;
	renameDevice(deviceId: string, name: string): Promise<Device>;
	/** 一次开关某台设备上全部 Agent 的联网 */
	setDeviceOnline(deviceId: string, online: boolean): Promise<Device>;
	/** 主人可见的全部 grant 摘要（执行端上报的回读，不是授权来源） */
	deviceGrants(deviceId: string): Promise<DeviceGrants>;
	/** 撤销一条 grant；`pending` 表示设备离线，命令排队中、尚未生效 */
	revokeDeviceGrant(deviceId: string, grantId: string): Promise<{ revoked: true; pending: boolean }>;
	/** Bot 的可操作设备（账号级允许表，默认全部） */
	botDevices(botId: string): Promise<BotDevices>;
	/** all 或 selected（空数组＝不允许任何设备） */
	setBotDevices(botId: string, input: { mode: "all" } | { mode: "selected"; devices: string[] }): Promise<BotDevices>;
	/** 主 Bot 的运行位置：默认云端，可指到设备上的既有 Bot；设备离线时由云端接手。 */
	mainBot(): Promise<MainBot>;
	setMainBot(input: { location: "cloud" } | { location: "device"; botId: string }): Promise<MainBot>;

	// 我的记忆（主 Bot 的云端记忆库；主 Bot 在设备上时没有云端记忆）
	memory(): Promise<MemoryPage>;
	memoryDocuments(): Promise<MemoryDocuments>;
	memoryDocument(path: string): Promise<MemoryDocument>;
	saveMemoryDocument(path: string, text: string): Promise<void>;
	deleteMemoryDocument(path: string): Promise<void>;
	saveMemorySummary(text: string): Promise<void>;

	// 联系人：Yonder 接入的全部 Agent 自动出现，不需要手动连接
	contacts(): Promise<Actor[]>;
	/** 开关某个 Agent 的联网（关闭后它不再接收平台消息） */
	setAgentOnline(agentId: string, online: boolean): Promise<Actor>;
	/** 新建云端 Bot：只需名字，模型与预设等用服务端默认值。 */
	createBot(input: { name: string; avatarUrl?: string }): Promise<Actor>;
	/**
	 * 幂等：账号没有任何自己的 Bot 时由服务端创建默认 Bot（小未 / Yonder Bot）并开好会话；已有则原样返回已有的。
	 * 服务端在账号行锁内判断，重复登录与并发请求不会产生多个。
	 */
	ensureDefaultBot(input: { name: string; englishName: string }): Promise<Actor>;

	/** 资料服务能力（云端 /market/capabilities）：头像上传与高级资料开关依赖它；探不到时按不支持处理。 */
	marketCapabilities(): Promise<MarketCapabilities>;
}

export interface MarketCapabilities {
	listingPolicy: boolean;
	sellerShops: boolean;
}
