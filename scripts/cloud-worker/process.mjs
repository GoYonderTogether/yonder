import { Client, Pool } from "pg";
import { redactError } from "../../packages/bot-core/dist/delivery/model-notice.js";
import { startCloudWorker } from "../../packages/cloud-host/dist/worker.js";
import { Runtime } from "../../packages/runtime-adapter/dist/index.js";

let queries = 0;
let watchedToken;
const inspectModels = Runtime.prototype.modelsFor;
Runtime.prototype.modelsFor = async function (config) {
	const models = await inspectModels.call(this, config);
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
