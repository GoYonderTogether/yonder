import { Client, Pool } from "pg";
import { redactError } from "../../packages/bot-core/dist/delivery/model-notice.js";
import { startCloudWorker } from "../../packages/cloud-host/dist/worker.js";
import { Runtime } from "../../packages/runtime-adapter/dist/index.js";
import { PostgresStorage } from "../../packages/runtime-adapter/dist/postgres/index.js";

let queries = 0;
let watchedToken;
const diagnostics = {
	opened: 0,
	closed: 0,
	modelsForCalls: 0,
	modelsBuilt: 0,
	archivedEntriesRead: 0,
	archivedEntryBytesRead: 0,
};
const modelsSeen = new WeakSet();
const openRuntime = Runtime.open;
Runtime.open = async function (options) {
	const runtime = await openRuntime.call(this, options);
	diagnostics.opened++;
	return runtime;
};
const closeRuntime = Runtime.prototype.close;
Runtime.prototype.close = async function () {
	await closeRuntime.call(this);
	diagnostics.closed++;
};
const inspectModels = Runtime.prototype.modelsFor;
Runtime.prototype.modelsFor = async function (config) {
	diagnostics.modelsForCalls++;
	const models = await inspectModels.call(this, config);
	if (modelsSeen.has(models)) return models;
	modelsSeen.add(models);
	diagnostics.modelsBuilt++;
	if (watchedToken) {
		for (const provider of models.getProviders()) {
			const instrumented = { ...provider };
			for (const name of ["stream", "streamSimple"]) {
				const stream = provider[name];
				if (!stream) continue;
				instrumented[name] = (model, context, options) => {
					process.send?.({
						type: "model-input",
						agent: config.agent,
						profile: config.profile,
						model: `${model.provider}/${model.id}`,
						markerPresent: JSON.stringify({ systemPrompt: context.systemPrompt, messages: context.messages }).includes(
							watchedToken,
						),
					});
					return stream.call(provider, model, context, options);
				};
			}
			models.setProvider(instrumented);
		}
	}
	return models;
};
const query = Client.prototype.query;
Client.prototype.query = function (...args) {
	queries++;
	return Reflect.apply(query, this, args);
};
function archived(entry) {
	if (
		entry?.model?.some(
			(message) => typeof message.content === "string" && message.content.startsWith("Archived load message "),
		)
	) {
		diagnostics.archivedEntriesRead++;
		diagnostics.archivedEntryBytesRead += Buffer.byteLength(JSON.stringify(entry));
	}
}
const scanEntries = PostgresStorage.prototype.scanEntries;
PostgresStorage.prototype.scanEntries = async function (...args) {
	const page = await scanEntries.apply(this, args);
	for (const entry of page.items) archived(entry);
	return page;
};
const entry = PostgresStorage.prototype.entry;
PostgresStorage.prototype.entry = async function (...args) {
	const result = await entry.apply(this, args);
	archived(result?.entry);
	return result;
};
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const worker = await startCloudWorker({
	pool,
	endpoint: process.env.YONDER_CLOUD_ENDPOINT,
	workerKeyFile: process.env.CLOUD_BOT_WORKER_KEY_FILE,
	modelKeyFile: process.env.CLOUD_BOT_MODEL_KEY_FILE,
	...(process.env.TEST_MODEL_BASE_URL ? { modelBaseUrl: process.env.TEST_MODEL_BASE_URL } : {}),
	report(error) {
		console.error(redactError(error instanceof Error ? error.message : "Worker failure"));
	},
});
process.send?.({
	type: "ready",
	state: {
		...worker.state(),
		queries,
		memory: process.memoryUsage(),
		diagnostics: { ...diagnostics },
		resources: process
			.getActiveResourcesInfo()
			.reduce((counts, type) => ({ ...counts, [type]: (counts[type] ?? 0) + 1 }), {}),
	},
});
process.on("message", async (message) => {
	if (message?.type === "watch-token") {
		watchedToken = message.token;
		process.send?.({ type: "token-watched" });
	}
	if (message === "state") {
		process.send?.({
			type: "state",
			state: {
				...worker.state(),
				queries,
				memory: process.memoryUsage(),
				diagnostics: { ...diagnostics },
				resources: process
					.getActiveResourcesInfo()
					.reduce((counts, type) => ({ ...counts, [type]: (counts[type] ?? 0) + 1 }), {}),
			},
		});
	}
	if (message === "close") {
		await worker.close();
		await pool.end();
		process.disconnect();
	}
});
