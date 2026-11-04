import { redactError } from "@yonder/bot-core/delivery/model-notice";
import { Pool } from "pg";
import { startCloudWorker } from "./worker.js";

const required = (name: string) => {
	const value = process.env[name];
	if (!value) throw new Error(`Missing ${name}`);
	return value;
};
const pool = new Pool({ connectionString: required("DATABASE_URL"), max: 10 });
try {
	const worker = await startCloudWorker({
		pool,
		endpoint: required("YONDER_CLOUD_ENDPOINT"),
		workerKeyFile: required("CLOUD_BOT_WORKER_KEY_FILE"),
		modelKeyFile: required("CLOUD_BOT_MODEL_KEY_FILE"),
		...(process.env.CLOUD_BOT_MODEL_BASE_URL ? { modelBaseUrl: process.env.CLOUD_BOT_MODEL_BASE_URL } : {}),
		...(process.env.CLOUD_BOT_MODEL ? { model: process.env.CLOUD_BOT_MODEL } : {}),
	});
	console.log("Cloud Bot worker ready");
	let closing = false;
	const close = async () => {
		if (closing) return;
		closing = true;
		await worker.close();
		await pool.end();
	};
	for (const signal of ["SIGINT", "SIGTERM"] as const)
		process.on(signal, () => {
			void close();
		});
} catch (error) {
	console.error(redactError(error instanceof Error ? error.message : String(error)));
	await pool.end();
	process.exitCode = 1;
}
