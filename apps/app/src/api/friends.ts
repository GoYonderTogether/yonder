import { request } from "./http";
import type { Actor } from "./types";
export interface PrivacySettings {
	friendVerification: boolean;
}
export interface FriendRequest {
	id: string;
	actor: Actor;
	direction: "incoming" | "outgoing";
	message: string;
	status: "pending" | "accepted" | "rejected";
	createdAt: number;
}
export interface FriendResult {
	status: "pending" | "accepted";
	id?: string;
}
export const friendsApi = {
	privacy: () => request<PrivacySettings>("/me/privacy"),
	updatePrivacy: (input: PrivacySettings) =>
		request<PrivacySettings>("/me/privacy", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}),
	requests: () => request<FriendRequest[]>("/friend-requests"),
	respond: (id: string, action: "accept" | "reject") =>
		request<{ status: FriendRequest["status"] }>(`/friend-requests/${encodeURIComponent(id)}/respond`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action }),
		}),
	async add(accountId: string, message: string): Promise<FriendResult> {
		const result = await request<FriendResult | Actor>("/friends", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ accountId, message }),
		});
		if ("status" in result && (result.status === "pending" || result.status === "accepted")) return result;
		// Compatible with older backends that immediately add a friend and return its Actor.
		if ("kind" in result && result.kind === "human" && result.id) return { status: "accepted" };
		throw new Error("好友服务返回了无法识别的结果");
	},
};
export function friendError(error: unknown, fallback: string) {
	return error && typeof error === "object" && "status" in error && error.status === 404
		? "好友验证服务尚未启用，请稍后重试。"
		: error instanceof Error
			? `${fallback}：${error.message}`
			: fallback;
}
