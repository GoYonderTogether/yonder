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
	const reminders = new Map<string, typeof due>();
	for (const item of due) {
		if (item.moment === "user-wait" && item.task.origin) {
			const group = reminders.get(item.task.origin) ?? [];
			group.push(item);
			reminders.set(item.task.origin, group);
			continue;
		}
		const { task, moment, minutes } = item;
		try {
			const result =
				moment === "stall"
					? await api.sessions.submit(
							task.session,
							{ text: STALL_NOTICE(task.title, task.state, minutes) },
							{ busy: "followup" },
						)
					: await api.sessions.command(task.session, "compact");
			store.momentResult(task.id, moment, { result }, now);
		} catch (error) {
			store.momentResult(task.id, moment, { error: error instanceof Error ? error.message : String(error) }, now);
		}
	}
	for (const [destination, group] of reminders) {
		if (!store.claimReminder(destination, now)) continue;
		for (const { task } of group)
			store.momentResult(
				task.id,
				"user-wait",
				{ error: "Reminder deferred: owner-facing self-check is not available" },
				now,
			);
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
