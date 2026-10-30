import { type NodeTarget, rpc } from "./client";
import { queryClient } from "./queries/index.js";
import type { SessionInfo } from "./types";

/** 契约 §18 `bots.overview`：该 Bot 绑定的渠道与它名下的子会话。 */
export interface BotOverview {
	channels: { id: string; label: string; kind?: string; lastActiveAt?: number }[];
	sessions: { session: SessionInfo }[];
}

export const botOverview = (bot: string) => rpc<BotOverview>("bots.overview", { bot });

/**
 * 工作列表要含已归档的「已完成」组，而 `sessions.list` 默认不含已归档（§18），所以两页合并。
 * 键以 `["sessions"]` 开头，归档/置顶/重命名后统一失效刷新。
 */
export async function workSessions(node?: NodeTarget): Promise<SessionInfo[]> {
	const [open, archived] = await Promise.all([
		rpc<SessionInfo[]>("sessions.list", {}, undefined, node),
		rpc<SessionInfo[]>("sessions.list", { filter: { archived: true } }, undefined, node),
	]);
	return [...open, ...archived];
}

const refresh = () => queryClient.invalidateQueries({ queryKey: ["sessions"] });

/** §18 会话状态变更：archive / unarchive / pin / unpin / rename（§13）。成功后刷新工作列表。 */
export const archiveSession = async (id: string) => {
	await rpc("sessions.archive", { id });
	await refresh();
};
export const unarchiveSession = async (id: string) => {
	await rpc("sessions.unarchive", { id });
	await refresh();
};
export const pinSession = async (id: string) => {
	await rpc("sessions.pin", { id });
	await refresh();
};
export const unpinSession = async (id: string) => {
	await rpc("sessions.unpin", { id });
	await refresh();
};
export const renameSession = async (id: string, title: string) => {
	await rpc("sessions.rename", { id, title });
	await refresh();
};
