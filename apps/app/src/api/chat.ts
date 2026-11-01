import { request } from "./http";
import type { Message } from "./types";

const endpoint = (id: string) => `/conversations/${encodeURIComponent(id)}`;
const json = (method: string, body?: unknown): RequestInit => ({
	method,
	...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});
export interface HistoryFilter {
	q?: string;
	from?: number;
	to?: number;
	kind?: "image";
	before?: number;
	limit?: number;
}
export interface HistoryPage {
	items: Message[];
	hasMore: boolean;
}
export const MUTE_DURATIONS = [
	{ seconds: 600, label: "10 分钟" },
	{ seconds: 3600, label: "1 小时" },
	{ seconds: 86400, label: "1 天" },
	{ seconds: 604800, label: "7 天" },
] as const;
export type MuteSeconds = 0 | 600 | 3600 | 86400 | 604800;
export const chatApi = {
	setNickname: (id: string, nickname: string | null) =>
		request<{ nickname: string | null }>(`${endpoint(id)}/me`, json("PATCH", { nickname })),
	update: (id: string, input: { title?: string; avatarUrl?: string | null }) =>
		request<{ title: string; avatarUrl: string | null }>(endpoint(id), json("PATCH", input)),
	setRole: (id: string, accountId: string, role: "owner" | "admin" | "member") =>
		request<{ role: string }>(`${endpoint(id)}/members/${encodeURIComponent(accountId)}`, json("PATCH", { role })),
	dissolve: (id: string) => request<void>(`${endpoint(id)}/dissolve`, json("POST")),
	leave: (id: string) => request<void>(`${endpoint(id)}/leave`, json("POST")),
	mute: (id: string, accountId: string, durationSeconds: MuteSeconds) =>
		request<{ mutedUntil: number | null }>(
			`${endpoint(id)}/members/${encodeURIComponent(accountId)}/mute`,
			json("PATCH", { durationSeconds }),
		),
	history: (id: string, filter: HistoryFilter = {}) => {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(filter))
			if (value !== undefined && value !== "") query.set(key, String(value));
		return request<HistoryPage>(`${endpoint(id)}/history?${query}`);
	},
	pinMessage: (id: string, messageId: string) =>
		request<void>(`${endpoint(id)}/pins/${encodeURIComponent(messageId)}`, json("PUT")),
	unpinMessage: (id: string, messageId: string) =>
		request<void>(`${endpoint(id)}/pins/${encodeURIComponent(messageId)}`, json("DELETE")),
	setAnnouncement: (id: string, messageId: string | null) =>
		request<void>(`${endpoint(id)}/announcement`, json("PUT", { messageId })),
};
export function chatError(error: unknown, fallback = "操作失败，请重试") {
	const message = error instanceof Error ? error.message : "";
	const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
	const messages: Record<string, string> = {
		muted: "你暂时被禁言，请在禁言结束后再发送消息。",
		not_member: "你已不在这个会话中。",
		invalid_request: "请检查填写的内容，或刷新群信息后重试。",
		invalid_title: "群名称需为 1–100 个字符。",
		invalid_avatar: "头像未通过校验，请重新上传。",
		invalid_duration: "请选择有效的禁言时长。",
		transfer_required: "请先移交群主，再退出或变更角色。",
		pin_limit: "最多置顶 10 条消息，请先取消一条。",
		too_many_pins: "最多置顶 10 条消息，请先取消一条。",
		owner_required: "只有群主可以执行此操作。",
		forbidden: "你没有执行此操作的权限，请刷新群信息。",
		upload_unavailable: "服务器暂时无法上传头像，请稍后重试。",
		unavailable: "服务器暂时不可用，请稍后重试。",
	};
	if (messages[message]) return messages[message];
	if (status === 404) return "服务器尚未启用此功能，或该会话已不存在。";
	if (status === 403) return "你没有执行此操作的权限，请刷新群信息。";
	if (error instanceof TypeError) return "网络连接失败，请重试。";
	if (status && Number(status) >= 500) return "服务器暂时不可用，请稍后重试。";
	return /^[a-z][a-z0-9_]*$/.test(message) ? fallback : message || fallback;
}
export async function uploadGroupAvatar(id: string, file: File, progress: (value: number) => void): Promise<string> {
	if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024)
		throw new Error("请选择不超过 5 MB 的 JPEG、PNG 或 WebP 图片");
	const signed = await request<{ uploadUrl: string; imageUrl: string; fields: Record<string, string> }>(
		`${endpoint(id)}/avatar-upload`,
		json("POST", { contentType: file.type, size: file.size }),
	);
	const data = new FormData();
	for (const [key, value] of Object.entries(signed.fields)) data.append(key, value);
	data.append("file", file);
	await new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", signed.uploadUrl);
		xhr.timeout = 60_000;
		xhr.ontimeout = () => reject(new Error("上传超时，请重试"));
		xhr.onabort = () => reject(new Error("上传已取消，请重试"));
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) progress(Math.round((event.loaded / event.total) * 100));
		};
		xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("图片上传失败，请重试")));
		xhr.onerror = () => reject(new Error("图片上传失败，请检查网络"));
		xhr.send(data);
	});
	return signed.imageUrl;
}
