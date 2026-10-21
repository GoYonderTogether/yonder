import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, type Session } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { openNodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import { expect, test } from "vitest";
// Characterize pinned native internals without a scheduler, provider, or vendored source changes.
import { resolveSettings } from "../../../pi-durable/dist/harness/agent.js";
import { applyBoundary, InboxDoc, prepareBoundary } from "../../../pi-durable/dist/harness/inbox.js";
import { admitSubmission } from "../../../pi-durable/dist/harness/submissions.js";

const C = BACKGROUND_CONTEXT;

test("native final boundary co-places steer and followUp after SQLite reopen; request metadata survives", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-effort-queue-"));
	const path = join(home, "state.db");
	const open = async () => createSession(await SqliteStorage.open(await openNodeSqliteDatabase(path)));
	let session: Session | undefined;
	try {
		session = await open();
		const conversation = await session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), C);
		const settings = resolveSettings(undefined);
		expect(settings.steeringMode).toBe("one-at-a-time");
		expect(settings.followUpMode).toBe("one-at-a-time");
		const admissionSession = session;
		const submit = (requestId: string, whenBusy: "steer" | "followUp", effort?: string) =>
			admissionSession.commit(
				(tx) =>
					admitSubmission(
						tx,
						conversation.id,
						{
							type: "input",
							requestId,
							whenBusy,
							content: requestId,
							entry: {
								kind: "yonder.message",
								data: { event: requestId, ...(effort ? { execution: { effort } } : {}) },
							},
						},
						Date.now(),
						settings,
					),
				C,
			);
		// Real admission creates the native run/task; no scheduler is started and no model is invoked.
		await submit("first", "followUp");
		const explicit = await submit("explicit", "followUp", "high");
		const steering = await submit("steering", "steer");
		const later = await submit("later", "followUp");
		expect((await session.snapshot(InboxDoc, conversation.id, C))?.items.map((item) => item.id)).toEqual([
			explicit,
			steering,
			later,
		]);
		await session.close(C);
		session = await open();
		const restored = await session.snapshot(InboxDoc, conversation.id, C);
		expect(restored?.items.map((item) => item.id)).toEqual([explicit, steering, later]);
		expect(restored?.items[0]?.entry).toEqual({
			kind: "yonder.message",
			data: { event: "explicit", execution: { effort: "high" } },
		});
		// Execute exactly the native final-boundary selection used by generation, not a fabricated model answer.
		const boundary = await session.commit(
			async (tx) => applyBoundary(tx, await prepareBoundary(tx, conversation.id, settings), "final", Date.now()),
			C,
		);
		expect(boundary.users).toEqual([explicit, steering]);
		expect((await session.snapshot(InboxDoc, conversation.id, C))?.items.map((item) => item.id)).toEqual([later]);
		const entries = await session.commit(async (tx) => {
			const input = await tx.submissionByRequest(conversation.id, "explicit");
			const steer = await tx.submissionByRequest(conversation.id, "steering");
			return [
				input?.entry ? await tx.entry(input.entry) : undefined,
				steer?.entry ? await tx.entry(steer.entry) : undefined,
			];
		}, C);
		expect(entries.map((entry) => entry?.data)).toEqual([
			{ event: "explicit", execution: { effort: "high" } },
			{ event: "steering" },
		]);
	} finally {
		await session?.close(C);
		await rm(home, { recursive: true, force: true });
	}
});
