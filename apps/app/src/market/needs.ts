import type { ListingQuery } from "../api/client";
import { describeMatch, taskTitle } from "./matching";
import type { AgentTask, Listing, Match, SearchBrief, WatchBrief, WatchFrequency, WatchTask } from "./types";

/**
 * 我的需求与云端 `watch_tasks`（yonder-cloud/server/src/market-watch.ts）之间的纯映射。
 * 页面用中文字段值，接口用枚举值，只在这一层互相转换。
 */

const PRIORITY: Record<WatchBrief["priority"], SearchBrief["priority"]> = {
	best: "最合适",
	price: "价格优先",
	local: "同城优先",
};
const PRIORITY_BACK: Record<SearchBrief["priority"], WatchBrief["priority"]> = {
	最合适: "best",
	价格优先: "price",
	同城优先: "local",
};
const FREQUENCY: Record<WatchFrequency, SearchBrief["frequency"]> = {
	hourly: "每小时",
	daily: "每天",
	manual: "手动",
};
const FREQUENCY_BACK: Record<SearchBrief["frequency"], WatchFrequency> = {
	每小时: "hourly",
	每天: "daily",
	手动: "manual",
};

/** 云端 brief → 页面 brief：`any` 显示成「不限」。 */
export function briefOf(task: WatchTask): SearchBrief {
	return {
		text: task.brief.text,
		category: task.brief.category === "any" ? "不限" : task.brief.category,
		budget: task.brief.budget,
		location: task.brief.location,
		priority: PRIORITY[task.brief.priority],
		frequency: FREQUENCY[task.frequency],
	};
}

/** 云端需求 → 页面需求；列表与编辑表单的初值都用它。 */
export function taskOf(task: WatchTask): AgentTask {
	return {
		...briefOf(task),
		id: task.id,
		title: task.title,
		active: task.active,
		checkedAt: task.checkedAt,
		seenIds: task.seenIds,
	};
}

/**
 * 页面 brief → 云端写入体。网页表单没有检查频率选项：新建一律「手动」，
 * 编辑时用 `editOf` 带上云端原频率，避免把 Bot 自己的排程改掉。
 */
export function inputOf(
	brief: SearchBrief,
	title = taskTitle(brief.text),
	frequency = FREQUENCY_BACK[brief.frequency],
): { title: string; brief: WatchBrief; frequency: WatchFrequency } {
	return {
		title: title.slice(0, 22),
		brief: {
			text: brief.text.slice(0, 500),
			category: brief.category === "不限" ? "any" : brief.category,
			budget: brief.budget,
			location: brief.location.slice(0, 32),
			priority: PRIORITY_BACK[brief.priority],
		},
		frequency,
	};
}

/** 编辑已有需求：标题与检查频率沿用云端的值，只改表单里的条件。 */
export function editOf(brief: SearchBrief, task: AgentTask) {
	return inputOf(brief, task.title, FREQUENCY_BACK[task.frequency]);
}

/**
 * 只读匹配查询：镜像云端 check 的筛选条件（关键词、范围、预算上限）。
 * 城市在云端只做 local 排序加权，公开列表接口没有这种排序，所以不放进查询，避免把邻近城市挡掉。
 * 绝不调用 `POST /watch-tasks/:id/check`：那会推进云端 seen_ids，吞掉插件的通知。
 */
export function needListingQuery(task: WatchTask): ListingQuery {
	return {
		q: task.brief.text.trim().slice(0, 200) || undefined,
		category: task.brief.category === "any" ? undefined : task.brief.category,
		max: task.brief.budget > 0 ? String(task.brief.budget) : undefined,
		sort: task.brief.priority === "price" ? "price_asc" : "relevance",
	};
}

/** 候选只取别人的帖子，理由来自帖子自己的字段。 */
export function matchesOf(listings: Listing[], task: AgentTask): Match[] {
	return listings.filter((listing) => !listing.mine).map((listing) => describeMatch(listing, task));
}
