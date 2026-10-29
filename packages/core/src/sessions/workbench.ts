import type { SessionInfo, SessionUpdate } from "@yonder/sdk";
import type { Store } from "../store/index.js";
import type { SessionWorkbench } from "../store/sessions.js";

/** Live fan-out of one update to the watchers of a session (`sessions.watch`, §15). */
export type Forward = (session: string, update: SessionUpdate) => void;

export interface BotOverview {
	channels: { id: string; label: string; kind?: string }[];
	sessions: SessionInfo[];
}

/**
 * Workbench state (contracts §18). Every change is written to the session row, recorded as `session.updated`
 * and fanned out to `sessions.watch`; `needsOwner` additionally notifies the owner (§16). The same object
 * backs the gateway methods and the agent tools, so both announce changes identically.
 */
export function createWorkbench({
	store,
	forward,
	notify,
	botOverview,
}: {
	store: Store;
	/** Live fan-out to `sessions.watch`; absent where nothing watches (tests). */
	forward?: Forward;
	notify: (id: string, input: { event: string; text: string }) => Promise<unknown>;
	botOverview: (agent: string) => Promise<BotOverview>;
}) {
	const apply = async (id: string, patch: SessionWorkbench, summary?: string): Promise<SessionInfo> => {
		const session = await store.sessions.get(id);
		if (!session) throw new Error(`Unknown session: ${id}`);
		await store.sessions.update(id, patch);
		await store.events.record({
			type: "session.updated",
			...(session.agent ? { from: `agent:${session.agent}` as const } : {}),
			data: { id, patch, ...(summary ? { summary } : {}) },
		});
		forward?.(id, { type: "event", name: "session.updated", data: { id, patch } });
		return (await store.sessions.get(id)) ?? session;
	};
	return {
		botOverview,
		archive: (id: string) => apply(id, { archivedAt: Date.now() }),
		unarchive: (id: string) => apply(id, { archivedAt: null }),
		pin: (id: string) => apply(id, { pinned: true }),
		unpin: (id: string) => apply(id, { pinned: false }),
		rename: (id: string, title: string) => apply(id, { title }),
		async handUp(id: string, reason: string) {
			const session = await apply(id, { needsOwner: { reason, since: Date.now() } }, reason);
			await notify(id, { event: "session.hand-up", text: reason });
			return session;
		},
	};
}
export type Workbench = ReturnType<typeof createWorkbench>;
