import type { PluginAPI, Ref, ToolContext } from "@yonder/sdk";
export interface GroupTurn {
	agent: string;
	session: string;
	direct: boolean;
	source: string;
	decision: string;
}
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
			reason: turn.direct ? "explicit mention" : "independent contribution",
			conversations: [...room.convs],
		},
	});
}
export async function releaseTurn(api: PluginAPI, room: TurnRoom, source: string) {
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
			reason: source,
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
