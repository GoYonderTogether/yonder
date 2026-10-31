/** 直接通道短合并：把同一段连续 @/追问收进一次运行（spec 11「省 token 与节奏」）。 */
export const DIRECT_MERGE_MS = 1500;
/** 自主候选：静默窗口与自首条起的硬顶。 */
export const QUIET_MIN_MS = 5000;
export const QUIET_MAX_MS = 15000;
export const MAX_WAIT_MS = 120000;

/**
 * 静默值在同一房间内固定、且对同批各候选一致（spec 11「省 token 与节奏」）：按房间 id 的确定性散列
 * 落在 5–15 秒，不用随机数，也不让“谁先说”取决于抽签。
 */
export function quietFor(roomId: string) {
	let hash = 0;
	for (const char of roomId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return QUIET_MIN_MS + (hash % (QUIET_MAX_MS - QUIET_MIN_MS + 1));
}

/** 自主候选的到期时间：静默窗口与 120 秒硬顶取早者，候选之间一致，不无限推迟。 */
export function quietDue(lastHumanAt: number | undefined, quiet: number, firsts: string[], now = Date.now()) {
	return Math.min((lastHumanAt ?? now) + quiet, ...firsts.map((first) => Date.parse(first) + MAX_WAIT_MS));
}

/** 房间内是否还有待处理的机会（候选未读或已就绪），决定是否排下一轮观察。 */
export function hasWork(candidates: Iterable<{ entries: unknown[]; willing?: unknown }>) {
	for (const candidate of candidates) if (candidate.entries.length || candidate.willing) return true;
	return false;
}
