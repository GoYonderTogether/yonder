import { PostgresStorage } from "../../packages/runtime-adapter/dist/postgres/index.js";
import { executionContext } from "../../packages/sdk/dist/index.js";

/** Read one source's frozen provider catalogue through the production runtime storage adapter. */
export async function deviceRunCatalogue(pool, tenantId, botId, sourceMessageId) {
	const sourceEvents = await pool.query(
		"SELECT id,routes FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='message.in' AND data->>'msgId'=$3",
		[tenantId, botId, sourceMessageId],
	);
	if (!sourceEvents.rows.length)
		return { direct: { matched: false, runCount: 0 }, inherited: { matched: false, runCount: 0 } };
	const directInputIds = new Set(sourceEvents.rows.map((event) => event.id));
	const inputIds = new Set(directInputIds);
	const sessions = new Set();
	for (const event of sourceEvents.rows)
		for (const route of event.routes ?? [])
			if (route.session && !route.dropped && Number.isSafeInteger(Number(route.session)))
				sessions.add(Number(route.session));

	const sessionInputs = await pool.query(
		"SELECT id,data FROM bot_events WHERE tenant_id=$1 AND bot_id=$2 AND type='session.input'",
		[tenantId, botId],
	);
	let expanded = true;
	while (expanded) {
		expanded = false;
		for (const event of sessionInputs.rows) {
			if (inputIds.has(event.id)) continue;
			const data = event.data;
			const refs = data.executionOwner?.inputs;
			if (!Array.isArray(refs) || !refs.some((id) => inputIds.has(id))) continue;
			inputIds.add(event.id);
			expanded = true;
			if (typeof data.session === "string" && Number.isSafeInteger(Number(data.session)))
				sessions.add(Number(data.session));
		}
	}
	if (!sessions.size) return { direct: { matched: false, runCount: 0 }, inherited: { matched: false, runCount: 0 } };

	const controller = new AbortController();
	const context = executionContext(controller.signal);
	const storage = await PostgresStorage.open(pool, tenantId, botId, context);
	try {
		const matched = { direct: [], inherited: [] };
		for (const conversationId of sessions) {
			const documents = await storage.scanDocuments(
				{
					scope: { kind: "conversation", conversationId },
					kind: "yonder.run",
					at: "current",
				},
				10_000,
				undefined,
				context,
			);
			for (const record of documents.items) {
				const document = await storage.document(record.id, "current", context);
				if (!document?.value.config) continue;
				const config = JSON.parse(document.value.config);
				const hostInputs = config.hostToolInputs ?? [];
				const isDirect = hostInputs.some((inputId) => directInputIds.has(inputId));
				if (!isDirect && !hostInputs.some((inputId) => inputIds.has(inputId))) continue;
				matched[isDirect ? "direct" : "inherited"].push({
					kind: document.record.kind,
					keys: Object.keys(config).sort(),
					started: Number(document.value.started),
					tools: (config.hostTools ?? [])
						.map((tool) => tool.name)
						.filter((name) => name.startsWith("device_"))
						.sort(),
				});
			}
		}
		const summarize = (runs) => {
			runs.sort((a, b) => b.started - a.started);
			return { matched: runs.length > 0, runCount: runs.length, ...(runs[0] ?? {}) };
		};
		return { direct: summarize(matched.direct), inherited: summarize(matched.inherited) };
	} finally {
		await storage.close(context);
	}
}
