import { useSyncExternalStore } from "react";

// 置顶、免打扰、已读位置只存客户端（C3 §6.3：不为此改内核契约）。
export type NotifyLevel = "all" | "mention" | "mute";
interface Prefs {
	pinned: string[];
	level: Record<string, NotifyLevel>;
	read: Record<string, number>; // 会话 id → 已读到的 transcript id
}
const KEY = "yonder.prefs";
const empty: Prefs = { pinned: [], level: {}, read: {} };

function load(): Prefs {
	try {
		return { ...empty, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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

export const togglePin = (id: string) =>
	commit({
		...state,
		pinned: state.pinned.includes(id) ? state.pinned.filter((x) => x !== id) : [id, ...state.pinned],
	});
export const setLevel = (id: string, level: NotifyLevel) =>
	commit({ ...state, level: { ...state.level, [id]: level } });
export const markRead = (id: string, upTo: number) => {
	if ((state.read[id] ?? -1) >= upTo) return;
	commit({ ...state, read: { ...state.read, [id]: upTo } });
};
