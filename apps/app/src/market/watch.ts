import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { inputOf, needListingQuery } from "./needs";
import { keepLegacyTasks, readLegacyTasks } from "./store";
import type { Listing, WatchTask } from "./types";

export const WATCH_TASKS_KEY = ["market-watch-tasks"] as const;
export const WATCH_MATCHES_KEY = "market-watch-matches";

/** 需求归账号所有；未登录（或匿名访客）不请求，避免拿 401/403 触发登录跳转。 */
export function useWatchTasks(enabled = true) {
	return useQuery({
		queryKey: [...WATCH_TASKS_KEY],
		queryFn: api.listWatchTasks,
		enabled,
		retry: false,
	});
}

export interface NeedMatches {
	items: Listing[];
	isPending: boolean;
	isError: boolean;
	refetch: () => void;
}

/** 每条需求一个只读搜索查询；云端一条需求最多 20 条，与 useListingLookup 一样逐条取。 */
export function useNeedMatches(tasks: WatchTask[]): Record<string, NeedMatches> {
	return useQueries({
		queries: tasks.map((task) => ({
			queryKey: [WATCH_MATCHES_KEY, task.id, task.brief],
			queryFn: () => api.marketListings(needListingQuery(task)),
			staleTime: 60_000,
		})),
		combine: (results) =>
			Object.fromEntries(
				tasks.map((task, index) => {
					const result = results[index];
					return [
						task.id,
						{
							items: result.data?.items ?? [],
							isPending: result.isPending,
							isError: result.isError,
							refetch: () => void result.refetch(),
						},
					];
				}),
			),
	});
}

export interface LegacyMigration {
	/** 已成功写进云端、并且已经从本地删掉的任务数。 */
	created: number;
	/** 云端还没收下、仍留在本地的任务数。 */
	remaining: number;
	/** 第一条失败原因；没有失败为 undefined。 */
	error?: string;
}

/** 云端拒绝需求写入时给用户看的说明，不假装成功。 */
export function needError(error: unknown) {
	const code = error instanceof Error ? error.message : "";
	return (
		(
			{
				unauthorized: "请登录后继续。",
				verify_required: "验证登录后才能保存需求。",
				conflict: "最多保存 20 条需求，请先删掉不用的。",
				not_found: "这条需求已不存在，请刷新后重试。",
				invalid_request: "需求条件有误，请检查后重试。",
				rate_limited: "操作太频繁，请稍后再试。",
			} as Record<string, string>
		)[code] ?? (code && !/^[a-z_]+$/.test(code) ? code : "操作失败，请稍后重试。")
	);
}

/**
 * 一次性迁移：把旧 localStorage 里的需求逐条写进云端。
 * 每条创建成功后才从本地副本移除；任何一条失败就停下，已成功的不会重复创建，剩下的下次再试。
 * 同一账号同时只跑一次（StrictMode 双调用、多个入口同时挂载都不会重复建任务）。
 */
const migrating = new Map<string, Promise<LegacyMigration>>();
export function migrateLegacyNeeds(
	storageKey: string,
	create: (input: ReturnType<typeof inputOf>) => Promise<WatchTask> = api.createWatchTask,
): Promise<LegacyMigration> {
	const running = migrating.get(storageKey);
	if (running) return running;
	const run = runMigration(storageKey, create).finally(() => migrating.delete(storageKey));
	migrating.set(storageKey, run);
	return run;
}

async function runMigration(
	storageKey: string,
	create: (input: ReturnType<typeof inputOf>) => Promise<WatchTask>,
): Promise<LegacyMigration> {
	const tasks = readLegacyTasks(storageKey);
	let remaining = tasks.length;
	for (const [index, task] of tasks.entries()) {
		try {
			// 旧副本里的标题是用户当时看到的，优先保留；没有才按描述生成。
			await create(inputOf(task, task.title.trim() || undefined));
		} catch (error) {
			keepLegacyTasks(storageKey, tasks.slice(index));
			return { created: index, remaining, error: error instanceof Error ? error.message : "迁移失败" };
		}
		remaining -= 1;
		keepLegacyTasks(storageKey, tasks.slice(index + 1));
	}
	return { created: tasks.length, remaining };
}
