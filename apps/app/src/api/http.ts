import type { ApiClient } from "./client";
import type { Actor, Card, CodeSent, Conversation, Device, Message, Session, ShareLink } from "./types";

/** 社交服务的基址：缺省同源；挂在本机网关下时由 VITE_SOCIAL_BASE 指向云端或测试后端。 */
const SOCIAL_BASE = (import.meta.env.VITE_SOCIAL_BASE as string | undefined) ?? "";

async function request<T>(path: string, init: RequestInit = {}, missingAsNull = false): Promise<T> {
	const response = await fetch(`${SOCIAL_BASE}/api${path}`, {
		credentials: SOCIAL_BASE ? "include" : "same-origin",
		...init,
	});
	const text = await response.text();
	if (!response.ok) {
		if (response.status === 401) window.dispatchEvent(new Event("yonder:unauthorized"));
		if (missingAsNull && response.status === 404) return null as T;
		let message = response.statusText;
		try {
			message = (JSON.parse(text) as { error?: string }).error ?? message;
		} catch {}
		// status 让页面区分「节点没有社交服务」（404）与其他失败。
		throw Object.assign(new Error(message), { status: response.status });
	}
	return (text ? JSON.parse(text) : undefined) as T;
}

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
	messages: (convId) => request<Message[]>(`/conversations/${encodeURIComponent(convId)}/messages?since=0`),
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
	groupInvite: (convId) => request(`/conversations/${encodeURIComponent(convId)}/invite`, json("POST")),
	createShareLink: (input) => request<ShareLink>("/share-links", json("POST", input)),
	getShareLink: (token) => request<ShareLink | null>(`/share-links/${encodeURIComponent(token)}`, {}, true),
	revokeShareLink: async (token) => {
		await request(`/share-links/${encodeURIComponent(token)}/revoke`, json("POST"));
	},
	groupPreview: (token) => request(`/groups/${encodeURIComponent(token)}`, {}, true),
	joinGroup: (token) => request<Conversation>(`/groups/${encodeURIComponent(token)}/join`, json("POST")),
	leaveConversation: (convId) => request(`/conversations/${encodeURIComponent(convId)}/leave`, json("POST")),
	markRead: (convId, seq) => request(`/conversations/${encodeURIComponent(convId)}/read`, json("POST", { seq })),
	subscribe(listener) {
		let active = true;
		let delay = 1000;
		let retry: number | undefined;
		let socket: WebSocket | undefined;
		const connect = () => {
			if (!active) return;
			const origin = new URL(SOCIAL_BASE || "/", location.href);
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
	createInvite: () => request("/device/invite", json("POST")),
	renameDevice: (deviceId, name) => request(`/devices/${encodeURIComponent(deviceId)}`, json("PATCH", { name })),
	setDeviceOnline: (deviceId, online) =>
		request(`/devices/${encodeURIComponent(deviceId)}/online`, json("PUT", { online })),
	contacts: () => request<Actor[]>("/contacts"),
	createBot: (input) => request<Actor>("/bots", json("POST", input)),
	ensureDefaultBot: (input) => request<Actor>("/me/default-bot", json("POST", input)),
	setAgentOnline: (agentId, online) =>
		request(`/agents/${encodeURIComponent(agentId)}/online`, json("PUT", { online })),
	deviceCode: (code) => request(`/device/code?code=${encodeURIComponent(code)}`),
	confirmDevice: (code) => request("/device/confirm", json("POST", { code })),
};
