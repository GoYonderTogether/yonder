import type { PluginAPI, Trigger } from "@yonder/sdk";
import { STALL_NOTICE } from "./prompts.js";
import type { Store } from "./store/index.js";

export interface Config {
	stallMinutes?: number;
	tailDigest?: { enabled?: boolean; lines?: number };
	userWaitMinutes?: number;
	moments?: { postCompact?: boolean; postRetain?: boolean };
}

export async function tick(api: PluginAPI, store: Store, config: Config = {}, now = Date.now()) {
	const due = store.claimMoments(
		now,
		config.stallMinutes ?? 30,
		config.userWaitMinutes ?? 120,
		config.moments?.postCompact === true,
	);
	for (const item of due) {
		const { task, moment, minutes } = item;
		try {
			const result =
				moment === "stall"
					? await api.sessions.submit(
							task.session,
							{ text: STALL_NOTICE(task.title, task.state, minutes) },
							{ busy: "followup" },
						)
					: moment === "user-wait"
						? await api.sessions.submit(
								task.session,
								{
									text: `请自检任务 ${task.ref}（${task.title}）。先核对当前证据：已完成则按任务完成契约记录；已过期则取消并记录原因；能自己处理则转为 active 并继续执行；确实需要主人决定则保留 waiting-user 并记录具体问题和选项。不要发送提醒。`,
								},
								{ busy: "followup" },
							)
						: await api.sessions.command(task.session, "compact");
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
