import type { SessionInfo } from "../transport/types";

export type Group = "bot" | "task" | "import";

/** 导入的 pi 会话：agent / profile / key 以 imports. 开头，只读。 */
export const isImported = (s: SessionInfo) =>
	[s.agent, s.profile, s.key].some((x) => typeof x === "string" && x.startsWith("imports."));

export function groupOf(s: SessionInfo): Group {
	if (isImported(s)) return "import";
	return s.mode === "main" || s.mode === "persistent" ? "bot" : "task";
}

/** `names` 是 agent id → Bot 显示名（bots.list），缺省或缺项时退回 agent id。 */
export function titleOf(s: SessionInfo, names?: ReadonlyMap<string, string>): string {
	if (isImported(s)) return s.key.replace(/^imports\./, "") || s.id;
	if (s.mode === "main" || s.mode === "persistent") return (s.agent && names?.get(s.agent)) || s.agent || s.profile;
	return `${s.profile} · ${s.id.slice(0, 6)}`;
}
export const GROUP_TITLE: Record<Group, string> = { bot: "Bot", task: "任务", import: "导入的 pi 会话" };
