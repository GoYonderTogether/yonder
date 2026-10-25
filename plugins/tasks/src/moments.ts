import type { PluginAPI, Trigger } from "@yonder/sdk";
import { STALL_NOTICE, USER_WAIT_NOTICE } from "./prompts.js";
import type { Store } from "./store.js";

export interface Config {
	stallMinutes?: number;
	userWaitMinutes?: number;
	moments?: { postCompact?: boolean; postRetain?: boolean };
}

export async function tick(api: PluginAPI, store: Store, config: Config = {}, now = Date.now()) {
	for (const { task, moment, minutes, waitingFor } of store.claimMoments(
		now,
		config.stallMinutes ?? 30,
		config.userWaitMinutes ?? 120,
		config.moments?.postCompact === true,
	)) {
		try {
			const result =
				moment === "stall"
					? await api.sessions.submit(
							task.session,
							{ text: STALL_NOTICE(task.title, task.state, minutes) },
							{ busy: "followup" },
						)
					: moment === "user-wait"
						? await api.messages.send({
								to: task.origin!,
								text: USER_WAIT_NOTICE(api.locale.startsWith("zh"), task.title, minutes, waitingFor),
							})
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
