import { batchSourceFrame, programSourceFrame } from "@yonder/bot-core/kernel/source-context";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db.js";
import type { SessionInfo } from "@yonder/sdk";
import { expect, test } from "vitest";

test("batch source frame verifies current sources and marks owner separately from ambient members", async () => {
	const conv = "conv:qq:group:source-frame";
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db, () => "person:owner");
		await store.identity().createPerson({ id: "owner", name: "Owner" });
		await store.identity().createPerson({ id: "guest", name: "Guest" });
		await store.identity().link("acct:qq:owner", "person:owner");
		await store.identity().link("acct:qq:guest", "person:guest");
		const session: SessionInfo = {
			id: "155",
			agent: "target",
			mode: "persistent",
			key: conv,
			profile: "group",
			opened: new Date().toISOString(),
			version: "test",
		};
		await store.sessions.put(session);
		const sourceRoute = [{ agent: "target", session: session.id, binding: "source", wake: "write" as const }];
		const owner = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:owner",
				conv,
				data: {
					kind: "group",
					text: "owner instruction",
					mentions: ["acct:qq:bot"],
					mentioned: false,
					replyTo: "reply-id",
					quote: { text: "quoted source" },
					social: { mentions: { bot: false }, nativeKind: "GROUP_MESSAGE_CREATE" },
				},
			},
			sourceRoute,
		);
		const guest = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:guest",
				conv,
				data: { kind: "group", text: "ambient member message" },
			},
			sourceRoute,
		);
		const sources = [owner, guest].sort((left, right) => left.id.localeCompare(right.id));
		const ids = sources.map((source) => source.id);
		const batch = await store.events.record(
			{
				type: "social.batch-ready",
				from: "plugin:social",
				conv,
				data: { agent: "target", through: ids.at(-1), sourceEvents: ids, policyRevision: "r1" },
			},
			[{ agent: "target", session: session.id, binding: "batch", wake: "run" }],
		);
		const frame = await batchSourceFrame(store, session, batch);
		expect(frame).toMatchObject({ status: "verified", agent: "target", conv, plugin: "social", through: ids.at(-1) });
		expect(frame?.sources).toHaveLength(2);
		expect(frame?.sources.find((source) => source.id === owner.id)).toMatchObject({
			relation: "owner",
			text: "owner instruction",
			mentions: ["acct:qq:bot"],
			mentioned: false,
			replyTo: "reply-id",
			quote: { text: "quoted source", textLength: 13, omitted: false },
			social: { mentions: { bot: false }, nativeKind: "GROUP_MESSAGE_CREATE" },
		});
		expect(frame?.sources.find((source) => source.id === guest.id)).toMatchObject({
			relation: "known",
			text: "ambient member message",
		});
		expect(frame?.sources.some((source) => source.from === "plugin:social")).toBe(false);
		expect(await batchSourceFrame(store, { ...session, mode: "main", key: "main" }, batch)).toBeUndefined();

		const mixed = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:guest",
				conv: "conv:qq:group:other",
				data: { text: "other conversation" },
			},
			sourceRoute,
		);
		const forged = await store.events.record(
			{
				type: "social.batch-ready",
				from: "plugin:social",
				conv,
				data: { agent: "target", through: mixed.id, sourceEvents: [mixed.id], policyRevision: "r1" },
			},
			[{ agent: "target", session: session.id, binding: "batch", wake: "run" }],
		);
		expect(await batchSourceFrame(store, session, forged)).toBeUndefined();
		const wrongPlugin = await store.events.record(
			{
				type: "social.batch-ready",
				from: "plugin:other",
				conv,
				data: { agent: "target", through: owner.id, sourceEvents: [owner.id], policyRevision: "r1" },
			},
			[{ agent: "target", session: session.id, binding: "batch", wake: "run" }],
		);
		expect(await batchSourceFrame(store, session, wrongPlugin)).toBeUndefined();

		const recent = [];
		for (let index = 0; index < 9; index++)
			recent.push(
				await store.events.record(
					{
						type: "message.in",
						from: "acct:qq:guest",
						conv,
						data: { text: `ambient ${index}` },
					},
					sourceRoute,
				),
			);
		recent.sort((left, right) => left.id.localeCompare(right.id));
		const through = recent.at(-1)?.id;
		if (!through) throw new Error("Missing source event");
		const boundedBatch = await store.events.record(
			{
				type: "social.batch-ready",
				from: "plugin:social",
				conv,
				data: {
					agent: "target",
					through,
					sourceEvents: recent.map((source) => source.id),
					policyRevision: "r1",
				},
			},
			[{ agent: "target", session: session.id, binding: "batch", wake: "run" }],
		);
		const bounded = await batchSourceFrame(store, session, boundedBatch);
		expect(bounded).toMatchObject({ limit: 8, truncated: true, omitted: 1 });
		expect(bounded?.sources).toHaveLength(8);

		const longSource = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:owner",
				conv,
				data: { text: "x".repeat(2500) },
			},
			sourceRoute,
		);
		const longBatch = await store.events.record(
			{
				type: "social.batch-ready",
				from: "plugin:social",
				conv,
				data: { agent: "target", through: longSource.id, sourceEvents: [longSource.id], policyRevision: "r1" },
			},
			[{ agent: "target", session: session.id, binding: "batch", wake: "run" }],
		);
		const longFrame = await batchSourceFrame(store, session, longBatch);
		expect(longFrame?.sources[0]).toMatchObject({ textLength: 2500, textOmitted: true });
		expect(longFrame?.sources[0]).not.toHaveProperty("text");
	} finally {
		await db.close();
	}
});

test("program input frame follows only its verified source chain", async () => {
	const conv = "conv:qq:group:program-source-frame";
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db, () => "person:owner");
		const session: SessionInfo = {
			id: "156",
			agent: "target",
			mode: "persistent",
			key: conv,
			profile: "group",
			opened: new Date().toISOString(),
			version: "test",
		};
		await store.sessions.put(session);
		const sourceRoute = [{ agent: "target", session: session.id, binding: "source", wake: "write" as const }];
		const source = await store.events.record(
			{ type: "message.in", from: "acct:qq:owner", conv, data: { kind: "group", text: "first request" } },
			sourceRoute,
		);
		const result = await store.events.record(
			{
				type: "runtime.tool-result",
				parent: source.id,
				conv,
				data: { session: session.id, job: "job-1", text: "program report" },
			},
			[{ agent: "target", session: session.id, binding: "background", wake: "run" }],
		);
		const later = await store.events.record(
			{ type: "message.in", from: "acct:qq:owner", conv, data: { kind: "group", text: "later request" } },
			sourceRoute,
		);
		const frame = await programSourceFrame(store, session.id, result);
		expect(frame).toEqual({
			role: "program-result",
			sources: { status: "verified", limit: 8, total: 1, omitted: 0, items: [{ id: source.id, conv }] },
		});
		expect(JSON.stringify(frame)).not.toContain(later.id);

		const continuation = await store.events.record(
			{
				type: "runtime.continuation",
				parent: source.id,
				conv,
				data: { session: session.id, job: "job-2", text: "continue" },
			},
			[{ agent: "target", session: session.id, binding: "continuation", wake: "run" }],
		);
		expect(await programSourceFrame(store, session.id, continuation)).toMatchObject({
			role: "continuation",
			sources: { status: "verified", total: 1, items: [{ id: source.id, conv }] },
		});
		expect(await programSourceFrame(store, "missing-session", result)).toMatchObject({
			role: "program-result",
			sources: { status: "unknown" },
		});
		const forged = await store.events.record(
			{
				type: "runtime.tool-result",
				parent: source.id,
				conv: "conv:qq:other",
				data: { session: session.id, job: "forged", text: "untrusted" },
			},
			[{ agent: "target", session: session.id, binding: "background", wake: "run" }],
		);
		expect(await programSourceFrame(store, session.id, forged)).toMatchObject({
			role: "program-result",
			sources: { status: "unknown" },
		});

		const many = [];
		for (let index = 0; index < 9; index++)
			many.push(
				await store.events.record(
					{
						type: "message.in",
						from: "acct:qq:owner",
						conv,
						data: { kind: "group", text: `source ${index}` },
					},
					sourceRoute,
				),
			);
		const sourceEvents = many.map((event) => event.id).sort();
		const batch = await store.events.record(
			{
				type: "social.batch-ready",
				from: "plugin:social",
				conv,
				data: { agent: "target", through: sourceEvents.at(-1), sourceEvents },
			},
			[{ agent: "target", session: session.id, binding: "batch", wake: "run" }],
		);
		const manyResult = await store.events.record(
			{
				type: "runtime.tool-result",
				parent: batch.id,
				conv,
				data: { session: session.id, job: "many", text: "report" },
			},
			[{ agent: "target", session: session.id, binding: "background", wake: "run" }],
		);
		const bounded = await programSourceFrame(store, session.id, manyResult);
		expect(bounded).toMatchObject({
			role: "program-result",
			sources: { status: "verified", limit: 8, total: 9, omitted: 1 },
		});
		expect(bounded?.sources.status === "verified" ? bounded.sources.items : []).toHaveLength(8);
	} finally {
		await db.close();
	}
});
