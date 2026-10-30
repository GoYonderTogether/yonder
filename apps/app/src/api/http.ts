import type { Listing } from "../market/types";
import type { ApiClient } from "./client";
import type { Actor, Card, CodeSent, Conversation, Device, Message, Session, ShareLink } from "./types";

/** 社交服务的基址：缺省同源；挂在本机网关下时由 VITE_SOCIAL_BASE 指向云端或测试后端。 */
const SOCIAL_BASE = (import.meta.env.VITE_SOCIAL_BASE as string | undefined) ?? "";

/**
 * 社交服务所在源站（缺省同源，不看应用挂载路径）：网关托管时应用在 /console/ 下，
 * 而社交 API 仍在源站根，别拿 appBase 去拼社交端点。
 */
export const socialOrigin = (): URL => new URL(SOCIAL_BASE || "/", location.href);

async function request<T>(path: string, init: RequestInit = {}, missingAsNull = false): Promise<T> {
	const response = await fetch(`${SOCIAL_BASE}/api${path}`, {
		credentials: SOCIAL_BASE ? "include" : "same-origin",
		...init,
	});
	const text = await response.text();
	if (!response.ok) {
		// 登录接口的 401 是「验证码不正确」，不是会话失效；不能触发登出跳转。
		if (response.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("yonder:unauthorized"));
		if (missingAsNull && response.status === 404) return null as T;
		let message = response.statusText;
		let retryAfter: number | undefined;
		try {
			const body = JSON.parse(text) as { error?: string; retryAfter?: number };
			message = body.error ?? message;
			retryAfter = body.retryAfter;
		} catch {}
		const header = Number(response.headers.get("Retry-After"));
		if (retryAfter === undefined && header > 0) retryAfter = header;
		// status 让页面区分「节点没有社交服务」（404）与其他失败；retryAfter 来自锁定响应的剩余秒数。
		throw Object.assign(new Error(message), { status: response.status, retryAfter });
	}
	return (text ? JSON.parse(text) : undefined) as T;
}

/** 云端帖子视图（server/src/market.ts listingView）转成页面用的 Listing：图片取首张，状态转 paused。 */
type CloudListing = Omit<Listing, "image" | "paused" | "metrics"> & {
	images: string[];
	status: "active" | "paused";
	updatedAt: number;
	metrics: { shortlists: number; likes?: number; humanViews?: number; agentViews?: number; inquiries?: number };
};
const toListing = ({ images, status, updatedAt: _updatedAt, metrics, ...rest }: CloudListing): Listing => ({
	...rest,
	image: images[0] ?? "",
	paused: status === "paused",
	metrics: {
		shortlists: metrics.shortlists,
		agentViews: metrics.agentViews ?? 0,
		humanViews: metrics.humanViews ?? 0,
		inquiries: metrics.inquiries ?? 0,
	},
});
const json = (method: string, body?: unknown): RequestInit => ({
	method,
	...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

export const httpApi: ApiClient = {
	resolve: (kind, reference) => request(`/resolve/${kind}/${encodeURIComponent(reference)}`, {}, true),
	session: () => request<Session | null>("/session"),
	register: (input) => request("/auth/register", json("POST", input)),
	login: (input) => request("/auth/login", json("POST", input)),
	sendCode: (input) => request<CodeSent>("/auth/code/send", json("POST", input)),
	verifyCode: (input) => request<Session>("/auth/code/verify", json("POST", input)),
	sendBindCode: (kind, target) => request<CodeSent>(`/me/${kind}/send-code`, json("POST", { [kind]: target })),
	confirmBindCode: (kind, target, code) => request<void>(`/me/${kind}/confirm`, json("POST", { [kind]: target, code })),
	createAnonymous: () => request("/auth/anonymous", json("POST")),
	logout: () => request("/auth/logout", json("POST")),
	updateProfile: (input) => request<Actor>("/me", json("PATCH", input)),

	actors: (ids) => request<Actor[]>(`/actors?${new URLSearchParams({ ids: ids.join(",") })}`),
	conversations: () => request<Conversation[]>("/conversations"),
	messages: (convId, page) =>
		request<Message[]>(
			`/conversations/${encodeURIComponent(convId)}/messages?${new URLSearchParams(page ? Object.entries(page).map(([key, value]) => [key, String(value)]) : { since: "0" })}`,
		),
	send: (convId, content, replyTo) =>
		request<Message>(
			`/conversations/${encodeURIComponent(convId)}/messages`,
			json("POST", { content, ...(replyTo === undefined ? {} : { replyTo }) }),
		),
	openDm: (actorId) => request<Conversation>("/conversations/dm", json("POST", { actorId })),
	startFromCard: (cardId, source) =>
		request<Conversation>(`/cards/${encodeURIComponent(cardId)}/start`, json("POST", source ? { source } : undefined)),
	cardConversation: (cardId) =>
		request<{ convId: string } | null>(`/cards/${encodeURIComponent(cardId)}/conversation`, {}, true),
	createGroup: (input) => request<Conversation>("/conversations/group", json("POST", input)),
	conversationDetail: (convId) => request(`/conversations/${encodeURIComponent(convId)}/detail`),
	renameGroup: (convId, title) => request(`/conversations/${encodeURIComponent(convId)}`, json("PATCH", { title })),
	setGroupRole: (convId, accountId, role) =>
		request(
			`/conversations/${encodeURIComponent(convId)}/members/${encodeURIComponent(accountId)}`,
			json("PATCH", { role }),
		),
	groupInvite: (convId) => request(`/conversations/${encodeURIComponent(convId)}/invite`, json("POST")),
	createShareLink: (input) => request<ShareLink>("/share-links", json("POST", input)),
	getShareLink: (token) => request<ShareLink | null>(`/share-links/${encodeURIComponent(token)}`, {}, true),
	revokeShareLink: async (token) => {
		await request(`/share-links/${encodeURIComponent(token)}/revoke`, json("POST"));
	},
	shareLinkStatus: (token) =>
		request<{ state: "active" | "share_exhausted" | "share_expired" | "share_revoked" } | null>(
			`/share-links/${encodeURIComponent(token)}/status`,
			{},
			true,
		),
	groupPreview: (token) => request(`/groups/${encodeURIComponent(token)}`, {}, true),
	joinGroup: (token, share) =>
		request<Conversation>(
			`/groups/${encodeURIComponent(token)}/join${share ? `?share=${encodeURIComponent(share)}` : ""}`,
			json("POST"),
		),
	leaveConversation: (convId) => request(`/conversations/${encodeURIComponent(convId)}/leave`, json("POST")),
	markRead: (convId, seq) => request(`/conversations/${encodeURIComponent(convId)}/read`, json("POST", { seq })),
	subscribe(listener) {
		let active = true;
		let delay = 1000;
		let retry: number | undefined;
		let socket: WebSocket | undefined;
		const connect = () => {
			if (!active) return;
			const origin = socialOrigin();
			const protocol = origin.protocol === "https:" ? "wss:" : "ws:";
			const ws = new WebSocket(`${protocol}//${origin.host}/ws`);
			socket = ws;
			ws.onopen = () => {
				delay = 1000;
			};
			ws.onmessage = ({ data }) => {
				try {
					const frame = JSON.parse(data) as { type?: string; message?: Message };
					if (frame.type === "message" && frame.message) listener(frame.message);
					// 设备上下线时服务端推 presence：通知页面重取联系人，Bot 在线状态与离线提示不靠刷新页面。
					else if (frame.type === "presence") window.dispatchEvent(new Event("yonder:presence"));
				} catch {}
			};
			ws.onerror = () => ws.close();
			ws.onclose = () => {
				if (!active) return;
				retry = window.setTimeout(connect, delay);
				delay = Math.min(delay * 2, 30_000);
			};
		};
		connect();
		return () => {
			active = false;
			window.clearTimeout(retry);
			socket?.close();
		};
	},

	cards: () => request<Card[]>("/cards"),
	card: (cardId) => request<Card | null>(`/cards/${encodeURIComponent(cardId)}`, {}, true),
	createCard: () => request("/cards", json("POST")),
	saveDraft: (cardId, input) => request(`/cards/${encodeURIComponent(cardId)}/draft`, json("PUT", input)),
	publish: (cardId) => request(`/cards/${encodeURIComponent(cardId)}/publish`, json("POST")),
	deleteCard: (cardId) => request(`/cards/${encodeURIComponent(cardId)}`, { method: "DELETE" }),
	collectCard: (cardId, source) =>
		request(`/cards/${encodeURIComponent(cardId)}/collect`, json("POST", source ? { source } : undefined)),

	profile: (id) => request(`/profile/${encodeURIComponent(id)}`, {}, true),
	setAgentPublic: (id, isPublic) =>
		request(`/agents/${encodeURIComponent(id)}/public`, json("PUT", { public: isPublic })),
	addFriend: (accountId) => request("/friends", json("POST", { accountId })),

	devices: () => request<Device[]>("/devices"),
	removeDevice: (deviceId) => request(`/devices/${encodeURIComponent(deviceId)}`, json("DELETE")),
	createInvite: () => request("/device/invite", json("POST")),
	renameDevice: (deviceId, name) => request(`/devices/${encodeURIComponent(deviceId)}`, json("PATCH", { name })),
	setDeviceOnline: (deviceId, online) =>
		request(`/devices/${encodeURIComponent(deviceId)}/online`, json("PUT", { online })),
	contacts: () => request<Actor[]>("/contacts"),
	createBot: (input) => request<Actor>("/bots", json("POST", input)),
	ensureDefaultBot: (input) => request<Actor>("/me/default-bot", json("POST", input)),
	marketListings: async () => (await request<{ items: CloudListing[] }>("/market/listings")).items.map(toListing),
	createListing: async (input) => toListing(await request<CloudListing>("/market/listings", json("POST", input))),
	updateListing: async (id, input) =>
		toListing(await request<CloudListing>(`/market/listings/${encodeURIComponent(id)}`, json("PATCH", input))),
	setListingPaused: async (id, paused) =>
		toListing(
			await request<CloudListing>(
				`/market/listings/${encodeURIComponent(id)}/${paused ? "pause" : "resume"}`,
				json("POST"),
			),
		),
	setAgentOnline: (agentId, online) =>
		request(`/agents/${encodeURIComponent(agentId)}/online`, json("PUT", { online })),
	deviceCode: (code) => request(`/device/code?code=${encodeURIComponent(code)}`),
	confirmDevice: (code) => request("/device/confirm", json("POST", { code })),
};
