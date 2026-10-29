import type { PluginAPI, Trigger } from "@yonder/sdk";
import { STALL_NOTICE } from "./prompts.js";
import type { Store } from "./store/index.js";

export interface Config {
	stallMinutes?: number;
	tailDigest?: { enabled?: boolean; lines?: number };
	userWaitMinutes?: number;
	moments?: { postCompact?: boolean; postRetain?: boolean };
}
/** 主人定的停滞窗口：默认 20 分钟，只接受 15–30。 */
export const DEFAULT_STALL_MINUTES = 20;
export const stallWindow = (minutes?: number) => Math.min(30, Math.max(15, minutes ?? DEFAULT_STALL_MINUTES));

/** 投递前二次校验：claim 之后任务可能已经推进、关闭，或会话已经换绑。 */
async function stallTarget(api: PluginAPI, store: Store, id: string, claimed: number) {
	const current = store.taskById(id);
	if (!current || current.task.state !== "active") return undefined;
	const progressed = current.history.some(
		(event) => event.seq > claimed && !event.kind.startsWith("moment") && event.kind !== "digest",
	);
	if (progressed) return undefined;
	return (await api.sessions.get(current.task.session)) ? current.task : undefined;
}

export async function tick(api: PluginAPI, store: Store, config: Config = {}, now = Date.now()) {
	const due = store.claimMoments(
		now,
		stallWindow(config.stallMinutes),
		config.userWaitMinutes ?? 120,
		config.moments?.postCompact === true,
	);
	for (const item of due) {
		const { task, moment, minutes, seq } = item;
		try {
			let result: unknown;
			if (moment === "stall") {
				// 二次校验没过就不投递：任务已经推进、关闭，或目标会话已经不在了。
				const target = await stallTarget(api, store, task.id, seq);
				if (!target) continue;
				result = await api.sessions.submit(
					target.session,
					{ text: STALL_NOTICE(target.title, target.state, minutes) },
					{ busy: "followup" },
				);
			} else if (moment === "user-wait") {
				result = await api.sessions.submit(
					task.session,
					{
						text: `请自检任务 ${task.ref}（${task.title}）。先调用 tasks_get，id 为 ${task.id}，读取任务和历史；再核对实际证据并使用任务工具记录结果：已完成则调用 tasks_done 并提供每项验收的证据；已过期则调用 tasks_update 设为 cancelled 并记录原因；能自己处理则调用 tasks_update 设为 active 并继续执行；确实需要主人决定则调用 tasks_update 保留 waiting-user，用 note 改写为“需要你决定：<一句话问题>（选项 A/B）”，不超过 120 字，不使用任务内部术语。不要发送提醒，也不要只用文字回答代替工具记录。`,
					},
					{ busy: "followup" },
				);
			} else {
				result = await api.sessions.command(task.session, "compact");
			}
			store.momentResult(task.id, moment, { result }, now);
		} catch (error) {
			store.momentResult(task.id, moment, { error: error instanceof Error ? error.message : String(error) }, now);
		}
	}
}

export function moments(api: PluginAPI, store: Store, config: Config): Trigger {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let running: Promise<void> = Promise.resolve();
	let stopped = true;
	const run = () => {
		running = tick(api, store, config)
			.catch((error) => api.log.error("Task moments failed", { error: String(error) }))
			.finally(() => {
				if (!stopped) timer = setTimeout(run, 60000);
			});
		return running;
	};
	return {
		id: "tasks-moments",
		async start() {
			stopped = false;
			await run();
		},
		async stop() {
			stopped = true;
			clearTimeout(timer);
			await running;
		},
	};
}
