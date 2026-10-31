import type { PluginAPI, Ref, YEvent } from "@yonder/sdk";
import { groupEvents } from "./group-history.js";
import type { GroupTurn, TurnRoom } from "./group-turns.js";

/**
 * 发送前再核最新公开事实（11「发言协调」）：机会已失效或目标已被可靠回应时丢弃未发草稿并记录原因。
 * 明确点名与点名后的追问各自保留机会，同题已答不取消另一位被点名者；普通（自主）候选看到房间内
 * 另一 Bot 的成功回答后结束该批机会，避免同一话题全部依次抢答。
 */
export async function superseded(
	api: PluginAPI,
	room: TurnRoom | undefined,
	turn: GroupTurn,
	agent: string,
	to: Ref,
): Promise<"answered" | undefined> {
	if (turn.direct) return undefined;
	for (const conv of room?.convs ?? [to]) {
		for await (const event of groupEvents(api, "message.out", conv)) {
			if (event.id <= turn.source) continue;
			if ((event.data as { delivery?: { ok?: boolean } }).delivery?.ok !== true) continue;
			const speaker = await speakerOf(api, event);
			if (speaker && speaker !== agent) return "answered";
		}
	}
	return undefined;
}

/** 谁发的这条成功出站：`agent:` 来源，或记录里真实产生它的会话所属 Agent。 */
export async function speakerOf(api: PluginAPI, event: YEvent) {
	if (event.from?.startsWith("agent:")) return event.from.slice(6);
	const session = (event.data as { session?: unknown }).session;
	if (typeof session !== "string") return undefined;
	return (await api.sessions.get(session))?.agent ?? undefined;
}

/**
 * 发送前复核：暂停、发言机会与最新公开事实。失效时释放机会并记录原因，草稿作废、不重试、不换目标。
 * 返回应抛出的错误信息；`undefined` 表示可以发送。
 */
export async function sendGuard(
	api: PluginAPI,
	options: {
		to: Ref;
		agent: string;
		session: string;
		room: TurnRoom | undefined;
		paused: boolean;
	},
): Promise<string | undefined> {
	const { to, agent, session, room } = options;
	if (!room?.convs.has(to)) return undefined;
	if (options.paused) return "本群已暂停此 Bot 的发言；不要重试发送，等待明确恢复。";
	if (room.turn?.session !== session) return "本群当前没有此Bot的发言机会；不要重试发送，等待下一次群输入。";
	const turn = room.turn;
	const reason = await superseded(api, room, turn, agent, to);
	if (!reason) return undefined;
	delete room.turn;
	await api.events.emit({
		type: "social.group-turn",
		from: "plugin:social",
		data: {
			action: "release",
			...turn,
			room: room.id,
			through: turn.source,
			reason,
			conversations: [...room.convs],
		},
	});
	return "本批目标已被可靠回应，未发草稿作废；不要重试发送，也不要自动换目标。";
}
