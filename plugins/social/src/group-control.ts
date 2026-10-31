import type { PluginAPI, YEvent } from "@yonder/sdk";
import type { GroupPause } from "./group-history.js";

export type Control = "stop" | "resume" | undefined;

/** 显式群控制：只有点名本 Bot 的「闭嘴/停止回复/恢复回复」才算，且正文已去掉称呼。 */
export function controlOf(text: string, name: string, agent: string): Control {
	const body = text
		.replace(/<@[^>]+>/g, "")
		.replaceAll(name, "")
		.replaceAll(agent, "")
		.replace(/^[\s,，:：]+|[\s。！!]+$/g, "");
	if (/^(?:请)?(?:闭嘴(?:[，, ]*禁言)?|禁言|停止回复|不用回答我|不用回复|别回复了)$/.test(body)) return "stop";
	if (/^(?:恢复回复|解除禁言|继续回复)$/.test(body)) return "resume";
	return undefined;
}

/** 持久群级暂停/恢复只给主人与可信群管理者；普通成员的“不用回答我”只退出该段互动。 */
export async function pauseFrom(
	api: PluginAPI,
	source: YEvent,
	agent: string,
	command: Control,
	before: GroupPause | undefined,
	body: string,
): Promise<{ pause: GroupPause | undefined; manager: boolean }> {
	if (!command) return { pause: before, manager: false };
	const manager =
		!!source.from?.startsWith("acct:") &&
		((await api.identity.relation(agent, source.from)) === "owner" ||
			["group-owner", "group-admin"].includes(
				(source.data as { social?: { senderRole?: string } }).social?.senderRole ?? "",
			));
	if (command === "resume") return { pause: undefined, manager };
	// 已经是群级暂停时，重复的停止不缩小既有范围。
	const pause: GroupPause | undefined =
		before?.scope === "group"
			? before
			: {
					source: source.id,
					...(source.from ? { actor: source.from } : {}),
					scope: manager && body !== "不用回答我" ? "group" : "interaction",
				};
	return { pause, manager };
}

/** 去掉称呼后的正文，用于暂停事实里的 reason。 */
export function controlBody(text: string, name: string, agent: string) {
	return text
		.replace(/<@[^>]+>/g, "")
		.replaceAll(name, "")
		.replaceAll(agent, "")
		.replace(/^[\s,，:：]+|[\s。！!]+$/g, "");
}

/** 已确认的停止/恢复：落一条策略变更事实，并收窄实际机会。 */
export async function applyControl(
	api: PluginAPI,
	options: {
		source: YEvent;
		agent: string;
		session: string;
		command: "stop" | "resume";
		body: string;
		before: GroupPause | undefined;
		pause: GroupPause | undefined;
		/**
		 * 收窄实际机会：删掉本会话的候选机会与排队，并在停止时中止该会话。
		 * 返回本命令是否影响正在运行/排队的那次互动。
		 */
		narrow: (affectsRun: boolean) => Promise<void>;
		awaiting: () => { source: string } | undefined;
	},
) {
	const { source, agent, command, body, before, pause } = options;
	await api.events.emit({
		type: "social.policy-change",
		from: "plugin:social",
		conv: source.conv!,
		parent: source.id,
		data: {
			kind: "group-pause",
			agent,
			actor: source.from,
			sourceEvent: source.id,
			before: { pause: before ?? null },
			after: { pause: pause ?? null },
			reason: body,
			result: "applied",
			restore: "owner or group manager explicitly resumes",
		},
	});
	const current = options.awaiting();
	const origin = current ? (await api.events.query({ id: current.source })).events[0]?.from : undefined;
	const affectsRun = pause?.scope === "group" || origin === source.from;
	await options.narrow(affectsRun);
	if (command === "stop" && affectsRun)
		void api.sessions
			.abort(options.session)
			.catch((error) => api.log.warn("Group stop failed", { session: options.session, error: String(error) }));
	return affectsRun;
}

/**
 * 点名的停止/恢复：先确认称呼与命令，再取名称、忽略方向、正文与当前暂停，最后只应用一次。
 * 返回是否已应用（调用方只在已应用时更新候选与排队）。
 */
export async function handleControl(
	api: PluginAPI,
	options: {
		source: YEvent;
		agent: string;
		session: string;
		claimed: Set<string>;
		/** 本 Bot/群当前的暂停事实，用作事实里的 before。 */
		before: GroupPause | undefined;
		/** 本 Bot 在当前房间的候选与排队，用于收窄实际机会。 */
		narrow: (affects: boolean, pause: GroupPause | undefined) => Promise<void>;
		awaiting: () => { source: string } | undefined;
	},
) {
	const { source, agent } = options;
	const text = String((source.data as { text?: string }).text ?? "");
	const name = (await api.agents.list()).find((a) => a.id === agent)?.name ?? agent;
	const native = source.data as { mentioned?: boolean; social?: { mentions?: { bot?: boolean } } };
	const addressed = (native.social?.mentions?.bot ?? native.mentioned) || text.includes(name) || text.includes(agent);
	if (!addressed) return undefined;
	const command = controlOf(text, name, agent);
	if (!command) return undefined;
	const body = controlBody(text, name, agent);
	const applied = await pauseFrom(api, source, agent, command, options.before, body);
	if (command === "resume" && !applied.manager) return undefined;
	// 检查与登记必须紧邻且同步：两个并发观察者都等在 await 上时只能有一个应用命令。
	if (options.claimed.has(source.id)) return undefined;
	options.claimed.add(source.id);
	await applyControl(api, {
		source,
		agent,
		session: options.session,
		command,
		body,
		before: options.before,
		pause: applied.pause,
		awaiting: options.awaiting,
		narrow: (affects) => options.narrow(affects, applied.pause),
	});
	return { command, pause: applied.pause };
}
