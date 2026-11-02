import { once } from "node:events";
import type { PluginAPI, Ref, ToolContext } from "@yonder/sdk";
export interface GroupTurnLike {
	agent: string;
	session: string;
	direct: boolean;
	focused?: boolean;
	source: string;
	decision: string;
}
type GroupTurnBase = Omit<GroupTurnLike, "direct" | "focused"> & {
	/** 直接通道短合并后的真实来源；`source` 是其中最后一条。 */
	sources?: string[];
	/** 本机会所属的会话；协调房间可跨多个 conv，这里必须是真实的那一个。 */
	conv?: string;
	/**
	 * 谁负责发起这次运行：`kernel` 是内核已按 run 绑定启动、social 只排发言机会；
	 * `social` 是官方群的 write 绑定，由 social 在短合并后发出 social.batch-ready。
	 */
	driver?: "kernel" | "social";
};
export type GroupTurn =
	| (GroupTurnBase & { direct: true; focused?: boolean })
	| (GroupTurnBase & { direct: false; focused: boolean });
export interface TurnRoom {
	id: string;
	convs: Set<Ref>;
	turn?: GroupTurn;
	waiting: GroupTurn[];
	wake: Set<() => void>;
}
/** Opportunity is transient; the only pending execution remains the native resident run. */
export async function grantTurn(api: PluginAPI, room: TurnRoom, turn: GroupTurn) {
	room.turn = turn;
	for (const wake of room.wake) wake();
	await api.events.emit({
		type: "social.group-turn",
		from: "plugin:social",
		data: {
			action: "grant",
			...turn,
			room: room.id,
			through: turn.source,
			reason: turn.direct
				? "explicit address"
				: turn.focused
					? "recent interaction follow-up"
					: turn.focused === false
						? "independent contribution"
						: "unknown opportunity",
			conversations: [...room.convs],
		},
	});
}
export async function grantAutonomousTurn(
	api: PluginAPI,
	room: TurnRoom,
	candidate: { agent: string; session: string },
	intention: { through: string; decision: string; focused: boolean },
) {
	await grantTurn(api, room, {
		agent: candidate.agent,
		session: candidate.session,
		source: intention.through,
		decision: intention.decision,
		direct: false,
		focused: intention.focused,
	});
}
export async function releaseTurn(api: PluginAPI, room: TurnRoom, source: string, reason?: string) {
	const turn = room.turn;
	if (!turn) return;
	delete room.turn;
	await api.events.emit({
		type: "social.group-turn",
		from: "plugin:social",
		data: {
			action: "release",
			...turn,
			room: room.id,
			through: turn.source,
			reason: reason ?? source,
			conversations: [...room.convs],
		},
	});
}
export async function awaitTurn(room: TurnRoom, ctx: ToolContext, stopped: () => boolean) {
	if (!room.waiting.some((t) => t.session === ctx.session)) return;
	await new Promise<void>((resolve, reject) => {
		const wake = () => {
			if (!stopped() && !ctx.signal.aborted && room.turn?.session !== ctx.session) return;
			room.wake.delete(wake);
			ctx.signal.removeEventListener("abort", wake);
			if (stopped() || ctx.signal.aborted) {
				room.waiting = room.waiting.filter((t) => t.session !== ctx.session);
				reject(Error("Group request ended while waiting for its turn"));
			} else resolve();
		};
		room.wake.add(wake);
		ctx.signal.addEventListener("abort", wake, { once: true });
		wake();
	});
}

/** Native hooks report ordinary errors and continue; cancellation must reach the active signal first. */
export async function stopGroupRequest(api: PluginAPI, ctx: ToolContext) {
	ctx.signal.throwIfAborted();
	const stopped = once(ctx.signal, "abort");
	// Native abort joins this invocation, so it must run outside the hook's awaited work.
	void api.sessions
		.abort(ctx.session)
		.catch((error) => api.log.warn("Group request stop failed", { error: String(error) }));
	await stopped;
	ctx.signal.throwIfAborted();
}
