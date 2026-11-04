import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { startCloudWorker } from "../../packages/cloud-host/dist/worker.js";
import { Runtime } from "../../packages/runtime-adapter/dist/index.js";
import { localCloud } from "./services.mjs";
import { modelTransport } from "./transport.mjs";

const folder = await mkdtemp(join(tmpdir(), "yonder-worker-lifecycle-"));
const key = randomBytes(32);
const workerKeyFile = join(folder, "worker.key");
const modelKeyFile = join(folder, "model.key");
await writeFile(workerKeyFile, key, { mode: 0o600 });
await writeFile(modelKeyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
const backend = await localCloud(key);
const transport = await modelTransport();
let worker;
let blocker;
let sampler;
const nativeBusy = Runtime.prototype.busy;
Runtime.prototype.busy = async function () {
	const busy = await nativeBusy.call(this);
	console.log(JSON.stringify({ phase: "native-work-check", busy }));
	return busy;
};
async function until(read, timeout = 10_000) {
	const started = Date.now();
	for (;;) {
		const value = await read();
		if (value) return value;
		assert.ok(Date.now() - started < timeout, "lifecycle condition timed out");
		await pause(20);
	}
}
async function createBot() {
	const owner = await backend.owner();
	const bot = await backend.request("/api/me/default-bot", owner, {});
	const conv = await backend.request("/api/conversations/dm", owner, { actorId: bot.id });
	return { owner, id: bot.id, conv: conv.id };
}
const send = (bot) =>
	backend.request(`/api/conversations/${bot.conv}/messages`, bot.owner, {
		content: { type: "text", text: "Reply briefly." },
	});
const result = (input) =>
	until(
		async () =>
			(
				await backend.pool.query(
					"SELECT m.content FROM cloud_bot_turns t JOIN messages m ON m.id=t.result_message_id WHERE t.source_message_id=$1",
					[input.id],
				)
			).rows[0]?.content,
	);
try {
	const [slow, fast] = await Promise.all([createBot(), createBot()]);
	worker = await startCloudWorker({
		pool: backend.pool,
		endpoint: backend.endpoint,
		workerKeyFile,
		modelKeyFile,
		modelBaseUrl: transport.baseUrl,
	});
	// A real PG lock suspends just one Bot's definition load, before its Runtime is opened.
	await backend.pool.query("CREATE TABLE activation_gate(bot_id TEXT)");
	await backend.pool.query("INSERT INTO activation_gate VALUES($1)", [slow.id]);
	await backend.pool.query(`CREATE FUNCTION hold_activation() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.path='yonder.yaml' AND EXISTS(SELECT 1 FROM activation_gate WHERE bot_id=NEW.bot_id) THEN
				PERFORM pg_advisory_xact_lock(17);
			END IF;
			RETURN NEW;
		END $$`);
	await backend.pool.query(
		"CREATE TRIGGER hold_activation BEFORE INSERT ON bot_files FOR EACH ROW EXECUTE FUNCTION hold_activation()",
	);
	blocker = await backend.pool.connect();
	await blocker.query("SELECT pg_advisory_lock(17)");
	const first = await send(slow);
	await until(
		async () => (await backend.pool.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rowCount,
	);
	const second = await send(fast);
	assert.notEqual((await result(second)).type, "error");
	assert.equal(
		(await backend.pool.query("SELECT result_message_id FROM cloud_bot_turns WHERE source_message_id=$1", [first.id]))
			.rows[0].result_message_id,
		null,
	);
	await blocker.query("SELECT pg_advisory_unlock(17)");
	blocker.release();
	blocker = undefined;
	assert.notEqual((await result(first)).type, "error");
	await backend.pool.query("DROP TRIGGER hold_activation ON bot_files");
	assert.equal(worker.state().highWater, 2);
	await until(() => worker.state().pendingSources === 0);
	const beforeIdle = worker.state();
	console.log(JSON.stringify({ phase: "activation-verified", state: beforeIdle }));
	const idleStarted = Date.now();
	sampler = setInterval(async () => {
		const deadlines = (await backend.pool.query("SELECT trigger_key,due_at FROM bot_deadlines")).rows;
		console.log(
			JSON.stringify({ phase: "idle-sample", elapsedMs: Date.now() - idleStarted, state: worker.state(), deadlines }),
		);
	}, 15000);
	await until(() => worker.state().active === 0, 80_000);
	const idleReleaseMs = Date.now() - idleStarted;
	assert.ok(idleReleaseMs >= 59_000, "idle Bot was released before its timeout");
	assert.notEqual((await result(await send(fast))).type, "error");
	await until(() => worker.state().pendingSources === 0);
	console.log(
		JSON.stringify(
			{
				slowActivationDoesNotBlockOtherTenant: true,
				bots: 2,
				beforeIdle,
				idleReleaseMs,
				idleReleasedBelowLruCapacity: true,
				reactivatedAfterRelease: true,
				final: worker.state(),
			},
			null,
			2,
		),
	);
} finally {
	clearInterval(sampler);
	Runtime.prototype.busy = nativeBusy;
	if (blocker) {
		await blocker.query("SELECT pg_advisory_unlock(17)");
		blocker.release();
	}
	await worker?.close();
	await transport.close();
	await backend.close();
	await rm(folder, { recursive: true, force: true });
}
