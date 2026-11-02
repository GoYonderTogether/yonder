import { batchSourceFrame } from "@yonder/bot-core/kernel/source-context";
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
