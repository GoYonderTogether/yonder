// 原型数据：仅用于前端原型演示，后端接入后整文件删除。内存实现，刷新即重置。

import type { ApiClient } from "./client";
import { cardSummary } from "./summary";
import type { Actor, Card, Conversation, Device, Message, MessageContent, Session } from "./types";

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

const me: Actor = { id: "u-me", kind: "human", name: "我" };
const devices = new Map<string, Device>([
	["d-1", { id: "d-1", name: "MacBook Pro", kind: "laptop", current: true, online: true }],
	["d-2", { id: "d-2", name: "云服务器", kind: "cloud", online: true }],
]);
const agent1: Actor = {
	id: "a-1",
	kind: "agent",
	name: "个人 Bot",
	deviceId: "d-1",
	ownerId: me.id,
	online: true,
	hasCard: true,
	public: true,
	note: "日常助手",
};
const agent2: Actor = {
	id: "a-2",
	kind: "agent",
	name: "工作 Bot",
	deviceId: "d-2",
	ownerId: me.id,
	online: true,
	note: "项目与客户",
};
const agent3: Actor = {
	id: "a-3",
	kind: "agent",
	name: "研究 Bot",
	deviceId: "d-1",
	ownerId: me.id,
	online: false,
	note: "资料与调研",
};
const noCard: Actor = { id: "u-empty", kind: "human", name: "还没有名片的人" };
const friend: Actor = { id: "u-2", kind: "human", name: "朋友", note: "好友" };
const mira: Actor = { id: "u-3", kind: "human", name: "Mira" };
const alex: Actor = { id: "u-4", kind: "human", name: "Alex" };
const svg = (title: string, sub: string, bg: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200"><rect width="360" height="200" rx="16" fill="${bg}"/><text x="24" y="92" fill="#fff" font-size="26" font-family="sans-serif" font-weight="700">${title}</text><text x="24" y="126" fill="#ffffffcc" font-size="14" font-family="sans-serif">${sub}</text></svg>`;

const actors = new Map<string, Actor>([me, agent1, agent2, agent3, friend, mira, alex, noCard].map((a) => [a.id, a]));
const mk = (c: Partial<Card> & Pick<Card, "id" | "ownerId" | "respondentId" | "title">): Card => ({
	kind: "persona",
	mine: true,
	summary: cardSummary(c.tagline, c.markdown ?? ""),
	markdown: "",
	status: "published",
	rev: 1,
	updatedAt: now(),
	publishedEver: c.status !== "draft",
	...c,
});
const cards = new Map<string, Card>(
	(
		[
			mk({ id: "k-0", kind: "default", ownerId: me.id, respondentId: me.id, title: "我的名片" }),
			mk({
				id: "k-1",
				kind: "agent",
				ownerId: agent1.id,
				respondentId: agent1.id,
				title: "个人 Bot",
				tagline: "日常助手，在线可直接聊",
				markdown: "# 个人 Bot\n\n这里是名片正文，支持 **Markdown**。\n",
				face: { theme: "night", tags: ["日常", "提醒"] },
				display: undefined,
			}),
			mk({
				id: "k-5",
				ownerId: me.id,
				respondentId: agent1.id,
				title: "给朋友",
				tagline: "随便聊聊",
				markdown: "# 我\n\n给朋友的轻松版本。\n",
				status: "draft",
				rev: 2,
				face: { theme: "paper", tags: ["设计", "咖啡"] },
			}),
			mk({
				id: "k-6",
				ownerId: friend.id,
				respondentId: friend.id,
				title: "朋友",
				tagline: "收到的名片",
				mine: false,
				markdown: "# 朋友\n\n对方的名片。\n",
			}),
			mk({
				id: "k-7",
				ownerId: mira.id,
				respondentId: mira.id,
				title: "Mira",
				tagline: "独立产品设计师",
				mine: false,
				markdown: "# Mira\n\n做产品设计。\n",
				face: { theme: "ink", tags: ["设计", "上海"] },
			}),
			mk({
				id: "k-8",
				ownerId: alex.id,
				respondentId: alex.id,
				title: "Alex",
				tagline: "做 AI 基础设施",
				mine: false,
				markdown: "# Alex\n\n基础设施工程师。\n",
			}),
		] as Card[]
	).map((c) => [c.id, c]),
);
void svg;
const published = new Map([...cards.values()].filter((c) => c.status === "published").map((c) => [c.id, { ...c }]));
const collected = new Map<string, { at: number; source: NonNullable<Card["source"]> }>([
	["k-6", { at: now() - 3 * 86400_000, source: "chat" }],
	["k-7", { at: now() - 3600_000, source: "scan" }],
	["k-8", { at: now() - 20 * 86400_000, source: "link" }],
]);
const friends = new Set([friend.id]);
const owns = (c: Card) =>
	!!session && (c.ownerId === session.actor.id || actors.get(c.ownerId)?.ownerId === session.actor.id);
const convs: Conversation[] = [
	{ id: "c-g", kind: "group", title: "我的 Bot 们", memberIds: [me.id, agent1.id, agent2.id, agent3.id], unread: 0 },
	{ id: "c-1", kind: "dm", title: agent1.name, memberIds: [me.id, agent1.id], unread: 0 },
	{ id: "c-2", kind: "dm", title: agent2.name, memberIds: [me.id, agent2.id], unread: 1 },
	{ id: "c-n", kind: "notice", title: "通知与审批", memberIds: [me.id], unread: 1 },
];
const msgs: Message[] = [];
let seq = 0;
const push = (convId: string, senderId: string, content: MessageContent): Message => {
	const m: Message = { id: `m-${++seq}`, convId, seq, senderId, content, createdAt: now() };
	msgs.push(m);
	const c = convs.find((x) => x.id === convId);
	if (c) c.last = m;
	return m;
};
push("c-g", agent1.id, {
	type: "markdown",
	text: "这是你的 Bot 群，接入 Yonder 的 Bot 都在这里。**@** 谁，谁来回答。",
});
push("c-1", agent1.id, { type: "markdown", text: "你好，我是你的个人 Bot。**我在线**，可以直接聊。" });
push("c-2", agent2.id, { type: "text", text: "客户的方案我整理好了。" });
push("c-n", agent1.id, {
	type: "interactive",
	title: "名片待审核",
	body: "Bot 起草了自己的名片，请预览后发布。",
	actions: [{ id: "review", label: "去审核" }],
	state: "pending",
	link: "/cards/k-1",
});

const groupTokens = new Map<string, string>();
let session: Session | null = null;
const listeners = new Set<(m: Message) => void>();
const emit = (m: Message) => {
	for (const l of listeners) l(m);
};

export const mockApi: ApiClient = {
	async resolve(kind, reference) {
		const items =
			kind === "actor"
				? [...actors.values()]
				: kind === "card"
					? [...cards.values()]
					: kind === "conversation"
						? convs
						: [...devices.values()];
		const item = items.find((i) => i.id === reference || i.code === reference);
		return item ? { id: item.id, code: item.code ?? item.id } : null;
	},
	async session() {
		await wait();
		return session;
	},
	async register(i) {
		await wait();
		me.name = i.name || i.email.split("@")[0];
		session = { actor: me };
		return session;
	},
	async createShareLink(input) {
		await wait();
		return {
			token: `mock-${input.targetId}`,
			kind: input.kind,
			targetId: input.targetId,
			maxUses: input.maxUses ?? 50,
			usedCount: 0,
			expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
			revokedAt: null,
		};
	},
	async getShareLink() {
		return null;
	},
	async revokeShareLink() {},
	async sendCode() {
		await wait();
		return { sent: true as const, retryAfter: 60 };
	},
	async verifyCode() {
		await wait();
		session = { actor: me };
		return session;
	},
	async sendBindCode() {
		await wait();
		return { sent: true as const, retryAfter: 60 };
	},
	async confirmBindCode() {
		await wait();
	},
	async login() {
		await wait();
		session = { actor: me };
		return session;
	},
	async createAnonymous() {
		await wait();
		const a: Actor = { id: `u-anon-${now()}`, kind: "human", name: "访客", anonymous: true };
		actors.set(a.id, a);
		session = { actor: a };
		return session;
	},
	async logout() {
		session = null;
	},
	async updateProfile(i) {
		me.name = i.name;
		return { ...me };
	},

	async actors(ids) {
		return ids.map((i) => actors.get(i)).filter((a): a is Actor => !!a);
	},
	async conversations() {
		await wait();
		return convs.map((c) => ({ ...c }));
	},
	async messages(id) {
		await wait();
		return msgs.filter((m) => m.convId === id);
	},
	async send(convId, content, replyTo) {
		const m = { ...push(convId, session?.actor.id ?? me.id, content), replyTo };
		emit(m);
		const c = convs.find((x) => x.id === convId);
		if (c?.kind === "dm" || c?.kind === "group") {
			const agentId = c.memberIds.find((i) => actors.get(i)?.kind === "agent" && actors.get(i)?.online);
			const a = agentId ? actors.get(agentId) : undefined;
			if (a?.online) setTimeout(() => emit(push(convId, a.id, { type: "markdown", text: "（原型回复）收到。" })), 700);
		}
		return m;
	},
	async openDm(actorId) {
		const s = session?.actor.id ?? me.id;
		const found = convs.find((c) => c.kind === "dm" && c.memberIds.includes(actorId) && c.memberIds.includes(s));
		if (found) return found;
		const c: Conversation = {
			id: `c-${now()}`,
			kind: "dm",
			title: actors.get(actorId)?.name ?? "会话",
			memberIds: [s, actorId],
			unread: 0,
		};
		convs.unshift(c);
		return c;
	},
	async startFromCard(cardId, source = "link") {
		await wait();
		const card = published.get(cardId);
		if (!card) throw new Error("名片不存在");
		const s = session?.actor.id ?? me.id;
		const target = card.respondentId;
		if (target !== s && !collected.has(cardId)) collected.set(cardId, { at: now(), source });
		if (target !== s && !session?.actor.anonymous) friends.add(card.ownerId);
		return mockApi.openDm(target);
	},
	async cardConversation(cardId) {
		await wait();
		const card = published.get(cardId) ?? cards.get(cardId);
		if (!card || !session) return null;
		const s = session.actor.id;
		const found = convs.find(
			(c) => c.kind === "dm" && c.memberIds.includes(s) && c.memberIds.includes(card.respondentId),
		);
		return found ? { convId: found.id } : null;
	},
	async createGroup({ title, memberIds }) {
		await wait();
		const s = session?.actor.id ?? me.id;
		const c: Conversation = {
			id: `c-g-${now()}`,
			kind: "group",
			title: title.trim() || "群聊",
			memberIds: [s, ...memberIds.filter((i) => i !== s)],
			unread: 0,
		};
		convs.unshift(c);
		return { ...c };
	},
	async conversationDetail(id) {
		await wait();
		const c = convs.find((x) => x.id === id);
		if (!c) throw new Error("会话不存在");
		return {
			id: c.id,
			kind: c.kind,
			title: c.title,
			members: c.memberIds.flatMap((i) => actors.get(i) ?? []).map((a) => ({ ...a })),
		};
	},
	async groupInvite(id) {
		await wait();
		if (!convs.some((x) => x.id === id)) throw new Error("会话不存在");
		groupTokens.set(`g${id.replace(/\W/g, "")}`, id);
		return { token: `g${id.replace(/\W/g, "")}` };
	},
	async groupPreview(token) {
		await wait();
		const c = convs.find((x) => x.id === groupTokens.get(token));
		if (!c) return null;
		const member = !!session && c.memberIds.includes(session.actor.id);
		return {
			title: c.title,
			memberCount: c.memberIds.length,
			members: c.memberIds.flatMap((i) => actors.get(i) ?? []).map((a) => ({ ...a })),
			member,
			...(member && { convId: c.id }),
		};
	},
	async joinGroup(token) {
		await wait();
		const c = convs.find((x) => x.id === groupTokens.get(token));
		if (!c) throw new Error("群二维码已失效");
		const s = session?.actor.id ?? me.id;
		if (!c.memberIds.includes(s)) c.memberIds.push(s);
		return { ...c };
	},
	async leaveConversation(id) {
		await wait();
		const s = session?.actor.id ?? me.id;
		const i = convs.findIndex((x) => x.id === id);
		if (i < 0) return;
		const c = convs[i];
		c.memberIds = c.memberIds.filter((m) => m !== s);
		convs.splice(i, 1);
	},
	async markRead() {},
	subscribe(l) {
		listeners.add(l);
		return () => {
			listeners.delete(l);
		};
	},

	async cards() {
		await wait();
		return [...cards.values()]
			.filter((c) => owns(c) || collected.has(c.id))
			.map((c) => {
				const got = collected.get(c.id);
				return {
					...(owns(c) ? c : (published.get(c.id) ?? c)),
					mine: owns(c),
					...(got && !owns(c) ? { collectedAt: got.at, source: got.source } : {}),
				};
			});
	},
	async card(id) {
		await wait();
		const draft = cards.get(id);
		const c = draft && owns(draft) ? draft : published.get(id);
		return c ? { ...c, mine: owns(c) } : null;
	},
	async createCard() {
		await wait();
		const c = mk({ id: `k-${now()}`, ownerId: me.id, respondentId: me.id, title: "新分身卡", status: "draft", rev: 0 });
		cards.set(c.id, c);
		return c;
	},
	async saveDraft(id, i) {
		await wait();
		const c = cards.get(id);
		if (!c) throw new Error("名片不存在");
		const n: Card = {
			...c,
			title: i.title,
			tagline: i.tagline === undefined ? c.tagline : i.tagline.trim() || null,
			summary: cardSummary(i.tagline === undefined ? c.tagline : i.tagline, i.markdown),
			markdown: i.markdown,
			display: i.display,
			face: i.face ?? c.face,
			rev: c.rev + 1,
			updatedAt: now(),
			status: "draft",
		};
		cards.set(id, n);
		return n;
	},
	async publish(id) {
		await wait();
		const c = cards.get(id);
		if (!c) throw new Error("没有草稿");
		const owner = actors.get(c.ownerId);
		if (owner?.kind === "agent" && !c.publishedEver) {
			owner.public = true;
			owner.hasCard = true;
		}
		const n: Card = { ...c, status: "published", publishedEver: true };
		cards.set(id, n);
		published.set(id, { ...n });
		return n;
	},
	async deleteCard(id) {
		if (cards.get(id)?.kind === "default") throw new Error("默认名片不能删除");
		cards.delete(id);
		published.delete(id);
		collected.delete(id);
	},
	async collectCard(id, source = "link") {
		if (!session || session.actor.anonymous) throw new Error("请先注册");
		if (!published.has(id)) throw new Error("名片不存在");
		collected.set(id, { at: now(), source });
	},
	async addFriend(accountId) {
		if (!session || session.actor.anonymous) throw new Error("请先注册，再添加朋友");
		if (!actors.has(accountId)) throw new Error("没有这个用户");
		friends.add(accountId);
	},
	async profile(id) {
		await wait();
		const actor = actors.get(id);
		if (!actor || actor.anonymous || (actor.kind === "agent" && !actor.public && actor.ownerId !== session?.actor.id))
			return null;
		const card = [...published.values()].find((c) => c.ownerId === id) ?? null;
		return {
			actor: { ...actor },
			summary: card?.summary ?? null,
			card,
			agents:
				actor.kind === "human"
					? [...actors.values()]
							.filter((a) => a.ownerId === id && a.public)
							.map((a) => ({ ...a, summary: [...published.values()].find((c) => c.ownerId === a.id)?.summary ?? null }))
					: [],
			owner: (() => {
				const owner = actor.ownerId ? actors.get(actor.ownerId) : undefined;
				return owner ? { ...owner } : null;
			})(),
		};
	},
	async setAgentPublic(id, isPublic) {
		const actor = actors.get(id);
		if (actor?.kind !== "agent" || actor.ownerId !== session?.actor.id) throw new Error("只有主人可以设置");
		actor.public = isPublic;
		return { ...actor };
	},
	async deviceCode() {
		return { name: "Mac mini · 家里", kind: "desktop" as const, status: "pending" };
	},
	async confirmDevice() {},

	async devices() {
		await wait();
		return [...devices.values()].map((d) => ({ ...d }));
	},
	async createInvite() {
		await wait();
		return { code: "0123456789", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
	}, // mock only: fixed-format fake invite
	async renameDevice(id, name) {
		const d = devices.get(id);
		if (!d) throw new Error("没有这台设备");
		d.name = name;
		return { ...d };
	},
	async setDeviceOnline(id, online) {
		const d = devices.get(id);
		if (!d) throw new Error("没有这台设备");
		d.online = online;
		actors.forEach((a) => {
			if (a.deviceId === id) a.online = online;
		});
		return { ...d };
	},
	async contacts() {
		await wait();
		return [...actors.values()]
			.filter((a) => a.ownerId === session?.actor.id || friends.has(a.id))
			.map((a) => ({ ...a }));
	},
	async createBot({ name }) {
		await wait();
		const owner = session?.actor.id ?? me.id;
		const bot: Actor = {
			id: `a-${now()}`,
			kind: "agent",
			name: name.trim(),
			ownerId: owner,
			online: true,
			public: false,
		};
		actors.set(bot.id, bot);
		return { ...bot };
	},
	async ensureDefaultBot({ name }) {
		await wait();
		const owner = session?.actor.id ?? me.id;
		const own = [...actors.values()].find((a) => a.kind === "agent" && a.ownerId === owner);
		if (own) return { ...own };
		const bot = await mockApi.createBot({ name });
		await mockApi.openDm(bot.id);
		return bot;
	},
	async setAgentOnline(id, online) {
		await wait();
		const a = actors.get(id);
		if (!a) throw new Error("没有这个 Bot");
		a.online = online;
		return { ...a };
	},
};
