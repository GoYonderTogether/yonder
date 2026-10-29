import type { Actor } from "../api/types";

/** Agent 默认头像的色相：一套固定的 6 个，明度彩度统一，按 id 取。只有 Agent 头像用颜色，其余全是黑白。 */
export const AGENT_HUES = [18, 52, 160, 205, 255, 315] as const;

export const agentHue = (a: Pick<Actor, "id">): number =>
	AGENT_HUES[[...a.id].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7) % AGENT_HUES.length];
