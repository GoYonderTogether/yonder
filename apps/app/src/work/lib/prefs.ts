import type { NotifyLevel } from "@yonder/gateway/protocol";
import { useSyncExternalStore } from "react";

// 置顶、免打扰、已读位置只存客户端（C3 §6.3：不为此改内核契约）。
export type { NotifyLevel } from "@yonder/gateway/protocol";
export interface GlobalNotifyPrefs {
	enabled: boolean;
	vibrate: boolean;
	previews: boolean;
}
interface Prefs {
	pinned: string[];
	level: Record<string, NotifyLevel>;
	read: Record<string, number>; // 会话 id → 已读到的 transcript id
	notify: GlobalNotifyPrefs;
}
const KEY = "yonder.prefs";
const empty: Prefs = { pinned: [], level: {}, read: {}, notify: { enabled: true, vibrate: true, previews: true } };

function load(): Prefs {
	try {
		const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Omit<Prefs, "level">> & {
			level?: Record<string, NotifyLevel | "mention">;
		};
		return {
			...empty,
			...stored,
			notify: { ...empty.notify, ...stored.notify },
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

export const togglePin = (id: string) =>
	commit({
		...state,
		pinned: state.pinned.includes(id) ? state.pinned.filter((x) => x !== id) : [id, ...state.pinned],
	});
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
