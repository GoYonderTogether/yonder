import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { EntryId, Harness, Tx } from "@earendil-works/pi-durable";
import type { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { cid, type OutboxEntry, SessionDoc } from "./docs.js";
import { fallbackReason, splitModelRef } from "./model-chain.js";
import type { ModelFallbackEvent, RuntimeOptions, RuntimeRun, RuntimeSessionConfig } from "./types.js";

export interface OutboxOptions {
	harness: Harness;
	storage: SqliteStorage;
	/** Observer sinks; a missing sink drops the event once its entry is removed. */
	sinks: Pick<RuntimeOptions, "onTodo" | "onModelFallback">;
	/** Commit bound to one conversation, the same handle the runtime uses for session state. */
	commit(session: string, change: (tx: Tx) => Promise<void>): Promise<void>;
}

/**
 * Events owed to observers, written in the same durable step as the state change they describe and removed once
 * handed over, so a crash in between repeats the event after restart (at-least-once; contracts §3).
 */
export class Outbox {
	private readonly delivering = new Map<string, Promise<void>>();
	constructor(private readonly options: OutboxOptions) {}

	/**
	 * Track one fallback episode per session and report its edges (contracts §3.3): the first answered run on a
	 * non-primary model starts it, the first answered run on the primary ends it. Runs without an answer say
	 * nothing about which model works, so they change nothing.
	 */
	async note(session: string, config: RuntimeSessionConfig, run: RuntimeRun, from?: number): Promise<void> {
		if (!run.model || run.status !== "done" || !this.options.sinks.onModelFallback) return;
		const primary = splitModelRef(config.resolved.model);
		const primaryRef = { provider: primary.provider, model: primary.modelId };
		const slash = run.model.indexOf("/");
		const actual = { provider: run.model.slice(0, slash), model: run.model.slice(slash + 1) };
		const onPrimary = actual.provider === primaryRef.provider && actual.model === primaryRef.model;
		const episode = (await this.options.harness.snapshot(SessionDoc, cid(session), C))?.fallback ?? null;
		if (onPrimary === !episode) return;
		let reason = episode?.reason ?? "error";
		if (!episode) {
			const entries = await this.options.storage.scanEntries(
				{ conversationId: cid(session), ...(from === undefined ? {} : { minEntryId: from as EntryId }) },
				Number.MAX_SAFE_INTEGER,
				undefined,
				C,
			);
			const attempt = entries.items.findLast(
				(entry) =>
					entry.kind === "pi.model-attempt" && (entry.data as { action?: string } | undefined)?.action === "fallback",
			);
			reason = fallbackReason((attempt?.data as { error?: string } | undefined)?.error);
		}
		const event: ModelFallbackEvent = onPrimary
			? {
					session,
					state: "recovered",
					from: { provider: episode!.provider, model: episode!.model },
					to: primaryRef,
					reason,
				}
			: { session, state: "fallback", from: primaryRef, to: actual, reason };
		// The episode state and the event it owes are one durable step; delivery below, or after a restart, drains it.
		await this.options.commit(session, async (tx) => {
			const doc = await tx.doc(SessionDoc, cid(session));
			doc.fallback = onPrimary ? null : { ...actual, reason };
			doc.outbox = [...(doc.outbox ?? []), JSON.stringify({ kind: "fallback", data: event } satisfies OutboxEntry)];
		});
		await this.deliver(session);
	}

	/**
	 * Hand owed observer events to the host, then remove exactly those from the outbox. A crash between handing
	 * over and removing repeats the event after restart (at-least-once); both payloads replace state wholesale.
	 */
	deliver(session: string): Promise<void> {
		const run = (this.delivering.get(session) ?? Promise.resolve()).then(async () => {
			const due = (await this.options.harness.snapshot(SessionDoc, cid(session), C))?.outbox ?? [];
			if (!due.length) return;
			for (const raw of due) {
				const entry = parseEntry(raw);
				if (entry.kind === "todo") await this.options.sinks.onTodo?.(entry.data);
				else await this.options.sinks.onModelFallback?.(entry.data);
			}
			await this.options.harness.commit(async (tx) => {
				const doc = await tx.doc(SessionDoc, cid(session));
				doc.outbox = (doc.outbox ?? []).slice(due.length);
			}, C);
		});
		const settled = run.catch(() => {});
		this.delivering.set(session, settled);
		void settled.then(() => {
			if (this.delivering.get(session) === settled) this.delivering.delete(session);
		});
		return run;
	}
}

/** Outbox entries are written by this runtime, so an unreadable one is corrupted state rather than input. */
function parseEntry(raw: string): OutboxEntry {
	try {
		return JSON.parse(raw) as OutboxEntry;
	} catch {
		throw new Error("Unreadable outbox entry");
	}
}
