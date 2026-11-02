import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { localCloud } from "./services.mjs";
import { modelTransport } from "./transport.mjs";

const folder = await mkdtemp(join(tmpdir(), "yonder-worker-cron-"));
const workerKeyFile = join(folder, "worker.key");
const modelKeyFile = join(folder, "model.key");
const workerKey = randomBytes(32);
await writeFile(workerKeyFile, workerKey, { mode: 0o600 });
await writeFile(modelKeyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
const backend = await localCloud(workerKey, 30);
const transport = await modelTransport();
const children = new Set();
const childStderr = new WeakMap();
const samples = [];
let sampler;
let worker;
const report = { scenario: "cron-program-deadline-lru-delivery", assertions: [] };

function sanitizeReason(value) {
	return String(value)
		.replace(/\bBearer\s+[^\s"'`,;]+/gi, "Bearer [redacted]")
		.replace(/(authorization\s*[:=]\s*)[^\s"'`,;]+/gi, "$1[redacted]")
		.replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s"'`,;]+/gi, "$1[redacted]")
		.replace(/[\r\n\t]+/g, " ")
		.slice(0, 300);
}

function stderrReason(child) {
	return (childStderr.get(child) ?? []).slice(-3).join(" | ");
}

const until = async (work, timeout = 90_000) => {
	const start = Date.now();
	for (;;) {
		const value = await work();
		if (value) return value;
		assert.ok(Date.now() - start < timeout, "cron worker condition timed out");
		await pause(20);
	}
};

async function startWorker() {
	const child = fork(new URL("./process.mjs", import.meta.url), [], {
		cwd: resolve(import.meta.dirname, "../.."),
		execArgv: ["--use-env-proxy"],
		stdio: ["ignore", "pipe", "pipe", "ipc"],
		env: {
			...process.env,
			DATABASE_URL: backend.databaseUrl,
			YONDER_CLOUD_ENDPOINT: backend.endpoint,
			CLOUD_BOT_WORKER_KEY_FILE: workerKeyFile,
			CLOUD_BOT_MODEL_KEY_FILE: modelKeyFile,
			TEST_MODEL_BASE_URL: transport.baseUrl,
		},
	});
	children.add(child);
	const stderr = [];
	let pending = "";
	child.stderr.on("data", (chunk) => {
		pending += chunk.toString();
		const lines = pending.split(/\r?\n/);
		pending = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			stderr.push(sanitizeReason(line));
			if (stderr.length > 20) stderr.shift();
		}
	});
	child.stderr.on("end", () => {
		if (pending.trim()) stderr.push(sanitizeReason(pending));
	});
	childStderr.set(child, stderr);
	const ready = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("worker ready timed out")), 30_000);
		child.on("message", (message) => {
			if (message.type === "ready") {
				clearTimeout(timer);
				resolve(message.state);
			}
		});
		child.once("exit", () =>
			reject(new Error(`worker exited before ready${stderrReason(child) ? `: ${stderrReason(child)}` : ""}`)),
		);
	});
	await ready;
	if (!sampler) {
		child.on("message", (message) => {
			if (message.state?.rss) samples.push(message.state.rss);
		});
		sampler = setInterval(() => {
			for (const current of children) if (current.connected) current.send("state");
		}, 50);
	}
	return child;
}

async function workerState(child) {
	const result = new Promise((resolve) => {
		const receive = (message) => {
			if (message.type !== "state") return;
			child.off("message", receive);
			resolve(message.state);
		};
		child.on("message", receive);
	});
	child.send("state");
	return result;
}

async function stopWorker(child) {
	if (!children.has(child)) return;
	const exited = once(child, "exit");
	if (child.connected) child.send("close");
	let timer;
	const closed = await Promise.race([
		exited.then(() => true),
		new Promise((resolve) => {
			timer = setTimeout(() => resolve(false), 10_000);
			timer.unref();
		}),
	]);
	clearTimeout(timer);
	if (!closed) {
		child.kill("SIGKILL");
		await exited;
		children.delete(child);
		throw new Error("worker close exceeded 10 seconds");
	}
	children.delete(child);
}

async function createBot() {
	const owner = await backend.owner();
	const actor = await backend.request("/api/me/default-bot", owner, {});
	const dm = await backend.request("/api/conversations/dm", owner, { actorId: actor.id });
	return { owner, id: actor.id, conv: dm.id };
}

async function sendTurn(bot, text, child = worker) {
	const before = await workerState(child);
	const message = await backend.request(`/api/conversations/${bot.conv}/messages`, bot.owner, {
		content: { type: "text", text },
	});
	const result = await until(
		async () =>
			(
				await backend.pool.query(
					"SELECT m.* FROM cloud_bot_turns t JOIN messages m ON m.id=t.result_message_id WHERE t.source_message_id=$1",
					[message.id],
				)
			).rows[0],
	);
	assert.notEqual(
		result.content?.type,
		"error",
		`source turn returned an error: ${sanitizeReason(result.content?.text ?? "unknown error")}${stderrReason(child) ? `; worker: ${stderrReason(child)}` : ""}`,
	);
	await until(async () => (await workerState(child)).completed > before.completed);
	return { message, result };
}

function holdProgramAck(botId) {
	const held = [];
	let enabled = true;
	for (const ws of backend.wss.clients) {
		const send = ws.send.bind(ws);
		ws.send = (...args) => {
			try {
				const frame = JSON.parse(Buffer.isBuffer(args[0]) ? args[0].toString() : String(args[0]));
				const content = frame.message?.content;
				if (
					enabled &&
					frame.type === "sent" &&
					frame.message?.senderId === botId &&
					content?.type === "markdown" &&
					content.text === "transport-test reply"
				) {
					held.push(() => send(...args));
					return ws;
				}
			} catch {}
			return send(...args);
		};
	}
	return {
		count: () => held.length,
		disable() {
			enabled = false;
		},
		release() {
			for (const send of held.splice(0)) send();
		},
	};
}

const pluginFiles = async (bot, path) =>
	(
		await backend.pool.query(
			"SELECT content FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='cron' AND root='' AND path=$3 AND kind='file'",
			[bot.owner.id, bot.id, path],
		)
	).rows[0]?.content;

async function cronRuns(bot) {
	const rows = await backend.pool.query(
		"SELECT content FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='cron' AND root='' AND path LIKE 'runs/%.json' AND kind='file' ORDER BY path",
		[bot.owner.id, bot.id],
	);
	return rows.rows.map((row) => JSON.parse(row.content));
}

try {
	const bot = await createBot();
	const others = await Promise.all(Array.from({ length: 20 }, createBot));
	const firstRequest = "cron-transport-create-once";
	const secondRequest = "cron-transport-create-missed-skip";
	const firstDueAt = Date.now() + 30_000;
	transport.tool((body) => {
		const marked = [...body.messages]
			.map((message, index) => ({ message, index }))
			.reverse()
			.find(({ message }) => {
				if (message.role !== "user") return false;
				const content = JSON.stringify(message.content);
				return content.includes(firstRequest) || content.includes(secondRequest);
			});
		if (!marked || body.messages.slice(marked.index + 1).some((message) => message.role === "tool")) return undefined;
		const content = JSON.stringify(marked.message.content);
		const marker = content.includes(firstRequest) ? firstRequest : secondRequest;
		const dueAt = marker === firstRequest ? firstDueAt : Date.now() + 10_000;
		return {
			name: "cron_manage",
			arguments: JSON.stringify({
				action: "create",
				job: {
					name: marker === firstRequest ? "transport-program-probe" : "transport-missed-skip-probe",
					schedule: { kind: "at", at: new Date(dueAt).toISOString(), timezone: "UTC" },
					payload: {
						kind: "preset",
						preset: "default",
						text: marker === firstRequest ? "transport-program-probe" : "transport-missed-skip-probe",
					},
					delivery: { to: `acct:card:${bot.id}:${bot.owner.id}`, via: "card" },
					missed: "skip",
					maxRuns: 1,
				},
			}),
		};
	});
	worker = await startWorker();
	await sendTurn(bot, firstRequest);
	const jobs = JSON.parse(
		await until(async () => {
			const value = await pluginFiles(bot, "jobs.json");
			return value && JSON.parse(value).length ? value : undefined;
		}),
	);
	assert.equal(jobs.length, 1);
	assert.equal(jobs[0].missed, "skip");
	assert.equal(jobs[0].payload.text, "transport-program-probe");
	await until(
		async () =>
			(
				await backend.pool.query("SELECT 1 FROM bot_deadlines WHERE tenant_id=$1 AND bot_id=$2 AND due_at=$3", [
					bot.owner.id,
					bot.id,
					Date.parse(jobs[0].schedule.at),
				])
			).rowCount === 1,
	);

	for (const other of others) await sendTurn(other, `Activate independent Bot ${other.id}.`);
	let state = await workerState(worker);
	assert.equal(state.active, 20);
	assert.equal(state.activeIds.includes(bot.id), false, "cron Bot was not evicted before its deadline");
	assert.equal(state.busy, 0);
	report.assertions.push("initial LRU eviction with 20 other active Bots");

	const ack = holdProgramAck(bot.id);
	transport.clear();
	transport.mode("hold");
	await until(async () =>
		transport.requests().some((request) => JSON.stringify(request.messages).includes("transport-program-probe")),
	);
	transport.mode("reply");
	state = await workerState(worker);
	assert.equal(state.activeIds.includes(bot.id), true);
	assert.equal((await cronRuns(bot))[0]?.status, "running", "held program model has no running cron execution");
	const activeOthers = others.filter((other) => state.activeIds.includes(other.id));
	assert.equal(activeOthers.length, 19);
	for (const other of activeOthers) await sendTurn(other, `Refresh active Bot ${other.id}.`);
	const duringModel = await createBot();
	await sendTurn(duringModel, "Activate during held program model.");
	state = await workerState(worker);
	assert.equal(state.activeIds.includes(bot.id), true, "held program Bot was evicted");
	report.assertions.push("held program Tool session stayed busy under LRU pressure");

	transport.release();
	await until(async () => ack.count() === 1);
	const runsBeforeAck = await cronRuns(bot);
	assert.equal(runsBeforeAck.length, 1);
	assert.equal(runsBeforeAck[0].job, jobs[0].id);
	assert.equal(runsBeforeAck[0].status, "running", "cron run completed before its real sent acknowledgement");
	const delivery = await until(
		async () =>
			(
				await backend.pool.query(
					"SELECT delivery_id,result_message_id FROM cloud_bot_deliveries WHERE bot_id=$1 AND conv_id=$2",
					[bot.id, bot.conv],
				)
			).rows[0],
	);
	assert.ok(delivery.delivery_id, "program delivery has no stable deliveryId");
	assert.ok(delivery.result_message_id, "program delivery has no persisted result message");
	const whileAckHeld = await createBot();
	await sendTurn(whileAckHeld, "Activate while program delivery acknowledgement is held.");
	state = await workerState(worker);
	assert.equal(state.activeIds.includes(bot.id), true, "unacknowledged program delivery Bot was evicted");
	report.assertions.push("pending channel sent acknowledgement kept cron Bot busy");

	ack.release();
	ack.disable();
	const completedRun = await until(async () => {
		const run = (await cronRuns(bot))[0];
		return run?.status === "done" ? run : undefined;
	});
	assert.equal(completedRun.text, "transport-test reply");
	assert.equal(completedRun.deliveryError, undefined);
	const runFiles = await backend.pool.query(
		"SELECT count(*)::int AS n FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='cron' AND root='' AND path LIKE 'runs/%.json' AND kind='file'",
		[bot.owner.id, bot.id],
	);
	assert.equal(runFiles.rows[0].n, 1, "one scheduled job produced more than one run file");
	const deliveries = await backend.pool.query(
		"SELECT d.delivery_id,d.result_message_id,m.content FROM cloud_bot_deliveries d JOIN messages m ON m.id=d.result_message_id WHERE d.bot_id=$1 AND d.conv_id=$2",
		[bot.id, bot.conv],
	);
	assert.equal(deliveries.rowCount, 1);
	assert.equal(deliveries.rows[0].delivery_id, delivery.delivery_id);
	assert.equal(deliveries.rows[0].result_message_id, delivery.result_message_id);
	assert.equal(deliveries.rows[0].content.text, "transport-test reply");
	const quotaTokenHash = (value) => createHash("sha256").update(value).digest("hex");
	const quotaKey = `yonder-card:limit:cloud-bot-replies-hourly:${quotaTokenHash(bot.owner.id)}`;
	const quota = Number(await backend.redis.get(quotaKey));
	assert.equal(quota, 2, "owner quota must count the one user turn and one cron program run");
	report.assertions.push("single PG cron run, durable program deliveryId, and owner quota 2");

	const afterAck = await createBot();
	await sendTurn(afterAck, "Activate after cron delivery acknowledgement.");
	state = await workerState(worker);
	assert.equal(state.activeIds.includes(bot.id), false, "idle completed cron Bot was not evicted as the LRU entry");
	const quotaAfterProgram = Number(await backend.redis.get(quotaKey));
	assert.equal(quotaAfterProgram, 2, "owner quota must count one user turn plus one cron program run");
	const second = await sendTurn(bot, "cron-transport-create-missed-skip");
	assert.equal(second.result.content.type === "error", false, "second real cron_manage turn failed");
	const jobsAfterSecondCreate = JSON.parse(await pluginFiles(bot, "jobs.json"));
	assert.equal(jobsAfterSecondCreate.length, 2);
	const skippedJob = jobsAfterSecondCreate.find((job) => job.name === "transport-missed-skip-probe");
	assert.ok(skippedJob);
	assert.equal(skippedJob.missed, "skip");
	assert.ok(Date.parse(skippedJob.schedule.at) > Date.now());
	await until(
		async () =>
			(
				await backend.pool.query("SELECT 1 FROM bot_deadlines WHERE tenant_id=$1 AND bot_id=$2 AND due_at=$3", [
					bot.owner.id,
					bot.id,
					Date.parse(skippedJob.schedule.at),
				])
			).rowCount === 1,
	);
	const modelRequestsBeforeRestart = transport.requests().length;
	await stopWorker(worker);
	worker = undefined;
	await until(async () => Date.now() > Date.parse(skippedJob.schedule.at) + 100);

	worker = await startWorker();
	const skippedRun = await until(async () =>
		(await cronRuns(bot)).find((run) => run.job === skippedJob.id && run.status === "skipped"),
	);
	assert.equal(skippedRun.text, "Missed while service was stopped");
	assert.equal(transport.requests().length, modelRequestsBeforeRestart, "missed skip unexpectedly invoked the model");
	const finalRuns = await cronRuns(bot);
	assert.equal(finalRuns.length, 2);
	assert.equal(finalRuns.find((run) => run.job === jobs[0].id)?.status, "done", "completed job reran after restart");
	assert.equal(
		(
			await backend.pool.query("SELECT count(*)::int AS n FROM cloud_bot_deliveries WHERE bot_id=$1 AND conv_id=$2", [
				bot.id,
				bot.conv,
			])
		).rows[0].n,
		1,
	);
	assert.equal(
		(
			await backend.pool.query(
				"SELECT count(*)::int AS n FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='cron' AND root='' AND path LIKE 'runs/%.json' AND kind='file'",
				[bot.owner.id, bot.id],
			)
		).rows[0].n,
		2,
	);
	assert.equal(
		Number(await backend.redis.get(quotaKey)),
		3,
		"only the second owner user turn should add quota after the program assertion",
	);
	report.assertions.push(
		"restart applied real missed:skip without a model request and did not rerun the completed job",
	);
	console.log(
		JSON.stringify(
			{
				...report,
				workerRestarts: 1,
				cronRuns: 2,
				deliveries: 1,
				quotaAfterFirstProgram: quotaAfterProgram,
				quotaFinal: 3,
				rssPeakBytes: Math.max(...samples),
			},
			null,
			2,
		),
	);
	await stopWorker(worker);
	worker = undefined;
} finally {
	transport.release();
	clearInterval(sampler);
	for (const child of children) await stopWorker(child).catch(() => {});
	await transport.close();
	await backend.close();
	await rm(folder, { recursive: true, force: true });
}
