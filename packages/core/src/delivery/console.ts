import { type OutMessage, parseRef, type YEvent } from "@yonder/sdk";
import { CONSOLE } from "../kernel/console.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";

const isConsole = (ref: string) => {
	const parsed = parseRef(ref);
	return (parsed.kind === "acct" || parsed.kind === "conv") && parsed.channel === CONSOLE;
};

/** The console is only a proactive owner target when the current turn came from it. */
export const consoleAllowed = (ref: string, scope: { event?: YEvent; events?: YEvent[] }) =>
	!isConsole(ref) ||
	(scope.events ?? (scope.event ? [scope.event] : [])).some((event) => !!event.conv && isConsole(event.conv));

/**
 * The console has no transport: a proactive message to it is delivered by writing it into the Bot's main session as a
 * notification event, which `sessions.watch` shows. Without an open main session the delivery fails.
 */
export async function persistConsole(
	store: Store,
	sessions: Sessions,
	target: string,
	msg: OutMessage,
	event: string,
	agent?: string | null,
) {
	if (!isConsole(target)) return;
	const parsed = parseRef(target);
	const bot = agent ?? (parsed.kind === "conv" ? parsed.id : undefined);
	if (!bot) throw new Error("无法确定接收消息的 Bot");
	const main = (await store.sessions.list({ agent: bot, open: true })).find((row) => row.mode === "main");
	if (!main) throw new Error(`Bot ${bot} 还没有主会话`);
	await sessions.notifyFrom(main.id, { event, text: msg.text ?? "" }, `agent:${bot}`);
}
