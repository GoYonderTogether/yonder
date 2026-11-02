import assert from "node:assert/strict";
import { migratePostgresRuntime, PostgresStorage } from "../../packages/runtime-adapter/dist/postgres/index.js";

/** Archived durable conversations exercise activation without forcing old context into the new turn. */
export async function seedHistory(pool, bots, messagesPerBot = 500) {
	await migratePostgresRuntime(pool);
	const context = {};
	for (const bot of bots) {
		const storage = await PostgresStorage.open(pool, bot.owner.id, bot.id);
		const conversationId = await storage.mintId();
		const documentId = await storage.mintId();
		await storage.commit(
			[
				{ type: "conversation", value: { id: conversationId } },
				{
					type: "document.create",
					record: {
						id: documentId,
						kind: "load.history",
						scope: { kind: "conversation", conversationId },
						history: "rewindable",
						fork: "asOf",
					},
					content: { kind: "base", version: 1, value: { messages: 0 } },
				},
			],
			context,
		);
		for (let first = 0; first < messagesPerBot; first += 50) {
			const writes = [];
			for (let index = first; index < Math.min(first + 50, messagesPerBot); index++) {
				writes.push({
					type: "entry",
					value: {
						id: await storage.mintId(),
						conversationId,
						kind: "message",
						model: [
							{
								role: "user",
								content: `Archived load message ${index + 1}. ${"history ".repeat(512)}`,
								timestamp: Date.now(),
							},
						],
					},
				});
			}
			writes.push({
				type: "document.change",
				id: documentId,
				content: {
					kind: "delta",
					version: 1,
					ops: [["s", ["messages"], Math.min(first + 50, messagesPerBot)]],
				},
			});
			await storage.commit(writes, context);
		}
		assert.equal(
			(await storage.scanEntries({ conversationId }, messagesPerBot + 1, undefined, context)).items.length,
			messagesPerBot,
		);
		await storage.close(context);
	}
	const count = await pool.query(
		"SELECT count(*)::int AS n FROM bot_runtime_records WHERE type='entry' AND bot_id=ANY($1::text[])",
		[bots.map((bot) => bot.id)],
	);
	assert.equal(count.rows[0].n, bots.length * messagesPerBot);
	return {
		bots: bots.length,
		messagesPerBot,
		messages: count.rows[0].n,
		documentChangesPerBot: Math.ceil(messagesPerBot / 50),
		minimumMessageTextBytes: 4096,
		archivedConversations: true,
	};
}
