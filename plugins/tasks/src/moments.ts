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
	for (const { task, history } of store.reminderCandidates()) {
		if (task.state !== "waiting-user" || !task.origin || !task.ownerAgent) continue;
		const check = history.findLast((event) => event.kind === "moment-result" && event.data.moment === "user-wait");
		const receipt = check?.data.result as { event?: string } | undefined;
		const start = history.findLast(
			(event) => event.kind === "moment" && event.data.moment === "user-wait" && event.seq < (check?.seq ?? 0),
		);
		if (
			!receipt?.event ||
			!start ||
			!history.some((event) => event.seq > start.seq && event.data.state === "waiting-user")
		)
			continue;
		const input = receipt.event;
		let after: string | undefined;
		let completed = false;
		do {
			const page = await api.events.query({ type: "run.end", limit: 1000, ...(after ? { after } : {}) });
			completed = page.events.some((event) => {
				const data = event.data as { status?: string; inputs?: string[] };
				return data.status === "done" && data.inputs?.includes(input);
			});
			after = page.next;
		} while (!completed && after);
		const session = await api.sessions.get(task.session);
		if (!completed || !session) continue;
		const note = history.findLast((event) => event.seq > start.seq && event.data.state === "waiting-user")?.data.note;
		if (!note?.startsWith("需要你决定：")) continue;
		const text = Array.from(note).slice(0, 120).join("");
		if (!store.claimReminder(task.origin, now)) continue;
		await api.messages.send({
			to: task.origin,
			text,
			owner: {
				agent: task.ownerAgent,
				session: task.session,
				profile: session.profile,
			},
			notification: { kind: "decision", key: `tasks:${task.id}:${receipt.event}`, sourceEvents: [receipt.event] },
		});
	}
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
									text: `请自检任务 ${task.ref}（${task.title}）。先调用 tasks_get，id 为 ${task.id}，读取任务和历史；再核对实际证据并使用任务工具记录结果：已完成则调用 tasks_done 并提供每项验收的证据；已过期则调用 tasks_update 设为 cancelled 并记录原因；能自己处理则调用 tasks_update 设为 active 并继续执行；确实需要主人决定则调用 tasks_update 保留 waiting-user，用 note 改写为“需要你决定：<一句话问题>（选项 A/B）”，不超过 120 字，不使用任务内部术语。不要发送提醒，也不要只用文字回答代替工具记录。`,
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
