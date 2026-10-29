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
	| { type: "text"; text: string }
	| { type: "markdown"; text: string }
	| { type: "image"; url: string; name?: string }
	| { type: "file"; url: string; name: string; bytes?: number }
	| {
			type: "interactive";
			title: string;
			body: string;
			actions: { id: string; label: string }[];
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
	id: string;
	/** Stable public reference; UUID id remains the internal API identity. */
	code?: string;
	kind: ConversationKind;
	title: string;
	memberIds: string[];
	unread: number;
	last?: Message;
}

export interface CardDisplay {
	kind: "html" | "svg";
	source: string;
}

/** 卡面结构（card-form.md §8），全部可选；只有名字必须。 */
export interface CardFace {
	theme: "mist" | "night" | "paper" | "ink";
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
}

export type DeviceKind = "laptop" | "desktop" | "server" | "cloud";

/** 运行 Yonder 的一台电脑。以后由多设备部署插件接入，目前只读。 */
export interface Device {
	id: string;
	/** Stable public reference; UUID id remains the internal API identity. */
	code?: string;
	name: string;
	kind: DeviceKind;
	/** 当前正在用的这台 */
	current?: boolean;
	online: boolean;
}

export interface Profile {
	actor: Actor;
	summary: string | null;
	card: Pick<Card, "id" | "code" | "markdown" | "display" | "tagline" | "summary" | "face"> | null;
	agents: Actor[];
	owner: Actor | null;
}

export interface ConversationDetail {
	id: string;
	/** Stable public reference; UUID id remains the internal API identity. */
	code?: string;
	kind: ConversationKind;
	title: string;
	members: Actor[];
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
