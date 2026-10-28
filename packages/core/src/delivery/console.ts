import type { Delivery, OutMessage, SessionInfo } from "@yonder/sdk";
import { parseRef, type YEvent } from "@yonder/sdk";
import { CONSOLE } from "../kernel/console.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";

/** Delivery scope; `proactive` marks an explicit send (tool or program), not a reply streamed from a run. */
export type Scope = { channelInstances?: string[]; event?: YEvent; events?: YEvent[]; proactive?: boolean };

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
	{ store, sessions }: { store: Store; sessions: Sessions },
	{ target }: { target: string },
	msg: OutMessage,
	event: string,
	session?: SessionInfo,
): Promise<Delivery> {
	if (!isConsole(target)) return { ok: true };
	const parsed = parseRef(target);
	const bot = session?.agent ?? (parsed.kind === "conv" ? parsed.id : undefined);
	const main = bot && (await store.sessions.list({ agent: bot, open: true })).find((row) => row.mode === "main");
	if (!main) return { ok: false, error: `控制台消息未能写入会话：Bot ${bot ?? "?"} 还没有主会话` };
	try {
		await sessions.notifyFrom(main.id, { event, text: msg.text ?? "" }, `agent:${bot}`);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: `控制台消息未能写入会话：${error instanceof Error ? error.message : String(error)}` };
	}
}
