import { useStore } from "@nanostores/react";
import { atom } from "nanostores";
import { useEffect } from "react";
import { $session } from "../store";
import { toast } from "../ui/Toast";
import { upgradeMarketState } from "./catalog";
import { initialMarketState } from "./data";
import { normalizeInquiries } from "./flows";
import type { AgentTask, MarketState } from "./types";

const stores = new Map<string, ReturnType<typeof atom<MarketState>>>();
/** 旧版本把需求（整条 brief）写在这里；现在需求归云端 watch_tasks，这个数组只用于一次性迁移。 */
function rawOf(key: string): Record<string, unknown> | null {
	try {
		const raw = JSON.parse(localStorage.getItem(key) ?? "null");
		return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
function read(key: string) {
	const initial = initialMarketState();
	const raw = rawOf(key);
	if (raw) {
		const state = upgradeMarketState(raw as Partial<MarketState>, initial);
		return { ...state, inquiries: normalizeInquiries(state.inquiries) };
	}
	return initial;
}
function write(key: string, state: MarketState, legacyTasks?: unknown) {
	localStorage.setItem(key, JSON.stringify(legacyTasks === undefined ? state : { ...state, tasks: legacyTasks }));
}
/** 读取尚未迁移的本地需求；结构不完整的条目直接丢弃，不猜字段。 */
export function readLegacyTasks(key: string): AgentTask[] {
	const tasks = rawOf(key)?.tasks;
	if (!Array.isArray(tasks)) return [];
	return tasks.flatMap(parseLegacyTask);
}

function parseLegacyTask(task: unknown): AgentTask[] {
	if (!task || typeof task !== "object" || Array.isArray(task)) return [];
	const item = task as Record<string, unknown>;
	if (typeof item.id !== "string" || typeof item.text !== "string" || !item.text.trim()) return [];
	return [
		{
			id: item.id,
			title: typeof item.title === "string" ? item.title : "",
			text: item.text,
			category: typeof item.category === "string" ? (item.category as AgentTask["category"]) : "不限",
			budget: typeof item.budget === "number" && Number.isFinite(item.budget) ? item.budget : 0,
			location: typeof item.location === "string" ? item.location : "不限",
			priority: item.priority === "价格优先" || item.priority === "同城优先" ? item.priority : ("最合适" as const),
			frequency: item.frequency === "每天" || item.frequency === "手动" ? item.frequency : ("每小时" as const),
			active: item.active !== false,
			checkedAt: typeof item.checkedAt === "number" ? item.checkedAt : 0,
			seenIds: Array.isArray(item.seenIds) ? item.seenIds.filter((id): id is string => typeof id === "string") : [],
		},
	];
}
/**
 * 迁移完成后只保留还没写进云端的那几条，写进云端的不再留在本机。
 * 写回时保留存储里其他字段（收藏、点赞、对比、咨询），只替换 tasks。
 */
export function keepLegacyTasks(key: string, remaining: AgentTask[]) {
	try {
		write(key, read(key), remaining);
	} catch {
		toast("本地需求副本未能清除，请检查浏览器存储空间", true);
	}
}

export function useMarketState() {
	const account = useStore($session)?.actor.id ?? "guest";
	const storageKey = `yonder-market-demo:v1:${account}`;
	if (!stores.has(storageKey)) stores.set(storageKey, atom(read(storageKey)));
	const store = stores.get(storageKey)!;
	const state = useStore(store);
	useEffect(() => {
		const sync = (event: StorageEvent) => {
			if (event.key === storageKey) store.set(read(storageKey));
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, [storageKey, store]);
	const setState = (update: (previous: MarketState) => MarketState) => {
		const next = update(store.get());
		store.set(next);
		try {
			// 还没迁移的本地需求继续留在原处，不能因为一次收藏就丢掉它们。
			write(storageKey, next, rawOf(storageKey)?.tasks);
		} catch {
			toast("存储空间不足，当前改动仅在本次打开时保留。请减少上传图片。", true);
		}
	};
	return { state, setState, storageKey };
}
