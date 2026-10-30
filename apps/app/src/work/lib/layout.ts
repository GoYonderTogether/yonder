import { useSyncExternalStore } from "react";
import { activeNode } from "../api/nodes";

// 右栏卡片栈与悬浮窗布局：按会话存 localStorage；右栏开关与宽度全局一份。
export type PanelKind =
	| "todos"
	| "goal"
	| "subtasks"
	| "attachments"
	| "views"
	| "context"
	| "background"
	| "wake"
	| `view:${string}`;

export const PANEL_TITLE: Record<PanelKind, string> = {
	todos: "待办",
	goal: "目标",
	subtasks: "子 Bot",
	attachments: "附件",
	views: "视图",
	context: "上下文",
	background: "后台任务",
	wake: "唤醒历史",
};
export function panelTitle(kind: PanelKind, viewTitles: Record<string, string>): string {
	return kind.startsWith("view:") ? (viewTitles[kind.slice(5)] ?? kind.slice(5)) : (PANEL_TITLE[kind] ?? kind);
}
/** 悬浮窗菜单里可开的面板 */
export const FLOATABLE: PanelKind[] = ["context", "background", "subtasks", "wake", "todos", "goal"];

/** 右栏卡片：同一组件 PanelCard，placement=rail */
export interface RailCard {
	id: string;
	tabs: PanelKind[];
	active: PanelKind;
}
/** 悬浮窗：同一组件 PanelCard，placement=floating；x/y 相对主区域左上角 */
export interface FloatCard {
	id: string;
	kind: PanelKind;
	x: number;
	y: number;
	collapsed: boolean;
}
export interface Layout {
	rail: RailCard[];
	float: FloatCard[];
}

export const DEFAULT_LAYOUT: Layout = {
	rail: [
		{ id: "c-todo", tabs: ["todos", "goal"], active: "todos" },
		{ id: "c-sub", tabs: ["subtasks", "background"], active: "subtasks" },
		{ id: "c-file", tabs: ["attachments", "views"], active: "attachments" },
	],
	float: [],
};

const kindsOf = (l: Layout) => new Set<PanelKind>([...l.rail.flatMap((c) => c.tabs), ...l.float.map((f) => f.kind)]);

function parseLayout(raw: string | null): Layout {
	try {
		const v = JSON.parse(raw ?? "null") as Layout | null;
		if (v && Array.isArray(v.rail) && Array.isArray(v.float)) return v;
	} catch {
		// 损坏的存档回到默认
	}
	return DEFAULT_LAYOUT;
}

const cache = new Map<string, Layout>();
const listeners = new Set<() => void>();
const key = (session: string) => `yonder.layout.${session}`;
const scope = (session: string) => (activeNode().deviceId ? `${activeNode().id}:${session}` : session);

export function getLayout(session: string): Layout {
	session = scope(session);
	let l = cache.get(session);
	if (!l) {
		l = parseLayout(localStorage.getItem(key(session)));
		cache.set(session, l);
	}
	return l;
}
export function setLayout(session: string, next: Layout) {
	session = scope(session);
	cache.set(session, next);
	localStorage.setItem(key(session), JSON.stringify(next));
	for (const fn of listeners) fn();
}
const subscribe = (fn: () => void) => {
	listeners.add(fn);
	return () => void listeners.delete(fn);
};
export const useLayout = (session: string) => useSyncExternalStore(subscribe, () => getLayout(session));

/** 把一个面板从当前位置摘下。卡片没有标签后自动删除。 */
function detach(l: Layout, kind: PanelKind): Layout {
	return {
		rail: l.rail
			.map((c) => {
				const tabs = c.tabs.filter((t) => t !== kind);
				return { ...c, tabs, active: tabs.includes(c.active) ? c.active : (tabs[0] ?? c.active) };
			})
			.filter((c) => c.tabs.length > 0),
		float: l.float.filter((f) => f.kind !== kind),
	};
}
const uid = () => Math.random().toString(36).slice(2, 8);

/** 弹出为悬浮窗（已存在则收起它）。 */
export function toggleFloat(session: string, kind: PanelKind, at = { x: 24, y: 64 }) {
	const l = getLayout(session);
	if (l.float.some((f) => f.kind === kind)) return setLayout(session, detach(l, kind));
	const d = detach(l, kind);
	const n = d.float.length * 28;
	setLayout(session, {
		...d,
		float: [...d.float, { id: `f-${uid()}`, kind, x: at.x + n, y: at.y + n, collapsed: false }],
	});
}
/** 悬浮窗停靠回右栏（新卡片放在栈顶）。 */
export function dock(session: string, kind: PanelKind) {
	const d = detach(getLayout(session), kind);
	setLayout(session, { ...d, rail: [{ id: `c-${uid()}`, tabs: [kind], active: kind }, ...d.rail] });
}
export function setActive(session: string, cardId: string, active: PanelKind) {
	const l = getLayout(session);
	setLayout(session, { ...l, rail: l.rail.map((c) => (c.id === cardId ? { ...c, active } : c)) });
}
export function reorderRail(session: string, ids: string[]) {
	const l = getLayout(session);
	const by = new Map(l.rail.map((c) => [c.id, c]));
	setLayout(session, { ...l, rail: ids.flatMap((id) => by.get(id) ?? []) });
}
export function patchFloat(session: string, id: string, patch: Partial<FloatCard>) {
	const l = getLayout(session);
	setLayout(session, { ...l, float: l.float.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
}
export const openKinds = (session: string) => kindsOf(getLayout(session));

// 右栏开关与宽度
export const RAIL_MIN = 260;
export const RAIL_MAX = 560;
interface RailPref {
	open: boolean;
	width: number;
}
const RAIL_KEY = "yonder.rail";
function loadRail(): RailPref {
	try {
		const v = JSON.parse(localStorage.getItem(RAIL_KEY) ?? "{}") as Partial<RailPref>;
		return {
			open: v.open ?? true,
			width: Math.min(RAIL_MAX, Math.max(RAIL_MIN, Number(v.width) || 320)),
		};
	} catch {
		return { open: true, width: 320 };
	}
}
let railPref = loadRail();
export function setRailPref(p: Partial<RailPref>) {
	railPref = { ...railPref, ...p, width: Math.min(RAIL_MAX, Math.max(RAIL_MIN, p.width ?? railPref.width)) };
	localStorage.setItem(RAIL_KEY, JSON.stringify(railPref));
	for (const fn of listeners) fn();
}
export const useRailPref = () => useSyncExternalStore(subscribe, () => railPref);
