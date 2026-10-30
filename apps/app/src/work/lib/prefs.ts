import type { NotifyLevel } from "@yonder/gateway/protocol";
import { useSyncExternalStore } from "react";

// 免打扰、已读位置只存客户端（C3 §6.3：不为此改内核契约）；置顶与归档走内核字段（§18）。
// 网页会话没有内核字段，置顶沿用这份客户端偏好（同一个 yonder.prefs 键），不另开存储。
export type { NotifyLevel } from "@yonder/gateway/protocol";
export interface GlobalNotifyPrefs {
	enabled: boolean;
	vibrate: boolean;
	previews: boolean;
}
interface Prefs {
	level: Record<string, NotifyLevel>;
	read: Record<string, number>; // 会话 id → 已读到的 transcript id
	notify: GlobalNotifyPrefs;
	/** 网页会话的置顶（消息列表按它排在前面）。 */
	pinned: string[];
}
const KEY = "yonder.prefs";
const empty: Prefs = {
	level: {},
	read: {},
	notify: { enabled: true, vibrate: true, previews: true },
	pinned: [],
};

function load(): Prefs {
	try {
		const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Omit<Prefs, "level">> & {
			level?: Record<string, NotifyLevel | "mention">;
		};
		return {
			notify: { ...empty.notify, ...stored.notify },
			read: stored.read ?? {},
			pinned: stored.pinned ?? [],
			level: Object.fromEntries(
				Object.entries(stored.level ?? {}).map(([id, level]) => [id, level === "mention" ? "mentions" : level]),
			),
		};
	} catch {
		return empty;
	}
}
let state = load();
const listeners = new Set<() => void>();
function commit(next: Prefs) {
	state = next;
	localStorage.setItem(KEY, JSON.stringify(next));
	for (const fn of listeners) fn();
}
export const usePrefs = () =>
	useSyncExternalStore(
		(fn) => {
			listeners.add(fn);
			return () => void listeners.delete(fn);
		},
		() => state,
	);

export const setLevel = (id: string, level: NotifyLevel) =>
	commit({ ...state, level: { ...state.level, [id]: level } });
export const setNotifyPrefs = (prefs: Partial<GlobalNotifyPrefs>) =>
	commit({ ...state, notify: { ...state.notify, ...prefs } });
export const effectiveLevel = (conv: NotifyLevel | undefined, global: GlobalNotifyPrefs): NotifyLevel =>
	global.enabled ? (conv ?? "all") : "mute";
export const markRead = (id: string, upTo: number) => {
	if ((state.read[id] ?? -1) >= upTo) return;
	commit({ ...state, read: { ...state.read, [id]: upTo } });
};
/** 置顶/取消置顶：只动这一条，其他偏好保持不变。 */
export const togglePin = (id: string) =>
	commit({
		...state,
		pinned: state.pinned.includes(id) ? state.pinned.filter((x) => x !== id) : [...state.pinned, id],
	});
