import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { redactError } from "../../packages/bot-core/dist/delivery/model-notice.js";
import { localCloud } from "./services.mjs";
import { modelTransport } from "./transport.mjs";

const live = process.argv.includes("--live");
const load = process.argv.includes("--load");
const card = process.argv.includes("--card");
const scenario = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
const folder = await mkdtemp(join(tmpdir(), "yonder-worker-verification-"));
const workerKey = randomBytes(32);
await writeFile(join(folder, "worker.key"), workerKey, { mode: 0o600 });
await writeFile(join(folder, "model.key"), randomBytes(32).toString("hex"), { mode: 0o600 });
const modelKeyFile = live ? join(homedir(), ".config/yonder/cloud-bot-model.key") : join(folder, "model.key");
const backend = await localCloud(workerKey, load ? 30 : 10);
const transport = live ? undefined : await modelTransport();
let child;
const output = [];
const rssSamples = [];
const modelInputs = [];
let sampler;
const report = {
	mode: live ? "real-glm-5.3-flash" : "loopback-transport",
	scenario: scenario ?? "reply",
	results: [],
	rounds: [],
};

async function until(work, timeout = 90000) {
	const before = Date.now();
	for (;;) {
		const result = await work();
		if (result) return result;
		assert.ok(Date.now() - before < timeout, "verification condition timed out");
		await pause(20);
	}
}
async function start() {
	child = fork(new URL("./process.mjs", import.meta.url), [], {
		cwd: resolve(import.meta.dirname, "../.."),
		execArgv: ["--use-env-proxy"],
		stdio: ["ignore", "pipe", "pipe", "ipc"],
		env: {
			...process.env,
			DATABASE_URL: backend.databaseUrl,
			YONDER_CLOUD_ENDPOINT: backend.endpoint,
			CLOUD_BOT_WORKER_KEY_FILE: join(folder, "worker.key"),
			CLOUD_BOT_MODEL_KEY_FILE: modelKeyFile,
			...(transport ? { TEST_MODEL_BASE_URL: transport.baseUrl } : {}),
		},
	});
	child.on("message", (message) => {
		if (message.state?.rss) rssSamples.push(message.state.rss);
		if (message.type === "model-input") modelInputs.push(message);
	});
	sampler = setInterval(() => {
		if (child?.connected) child.send("state");
	}, 50);
	child.stdout.on("data", (chunk) => output.push(chunk.toString()));
	child.stderr.on("data", (chunk) => output.push(chunk.toString()));
	const state = await new Promise((done, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`Worker ready timeout: ${redactError(output.join("").slice(-1500))}`)),
			30000,
		);
		child.on("message", (message) => {
			if (message.type === "ready") {
				clearTimeout(timeout);
				done(message.state);
			}
		});
		child.once("exit", () => reject(new Error(`Worker exited before ready: ${output.join("").slice(-1500)}`)));
	});
	report.idle = state;
	console.log(JSON.stringify({ phase: "worker-ready", pid: child.pid, state }));
	assert.ok(state.rss <= 150_000_000, `idle RSS exceeds 150 MB: ${state.rss}`);
}
async function state() {
	const result = new Promise((done) => {
		const receive = (message) => {
			if (message.type === "state") {
				child.off("message", receive);
				done(message.state);
			}
		};
		child.on("message", receive);
	});
	child.send("state");
	return result;
}
async function stop() {
	if (!child || child.exitCode !== null) return;
	const exited = once(child, "exit");
	child.send("close");
	let timer;
	const timed = new Promise((done) => {
		timer = setTimeout(() => done(false), 10000);
		timer.unref();
	});
	const finished = await Promise.race([exited.then(() => true), timed]);
	clearTimeout(timer);
	clearInterval(sampler);
	if (!finished) {
		child.kill("SIGKILL");
		await exited;
		throw new Error("Worker close exceeded 10 seconds");
	}
	child = undefined;
}
async function createBot() {
	const owner = await backend.owner();
	const actor = await backend.request("/api/me/default-bot", owner, {});
	const dm = await backend.request("/api/conversations/dm", owner, { actorId: actor.id });
	return { owner, id: actor.id, conv: dm.id };
}
async function turn(bot, text, expectError = false) {
	const before = await state();
	const previousMessages = (
		await backend.pool.query("SELECT count(*)::int AS n FROM messages WHERE conv_id=$1 AND sender_id=$2", [
			bot.conv,
			bot.id,
		])
	).rows[0].n;
	const message = await backend.request(`/api/conversations/${bot.conv}/messages`, bot.owner, {
		content: { type: "text", text },
	});
	const result = await until(
		async () =>
			(
				await backend.pool.query(
					`SELECT m.* FROM cloud_bot_turns t JOIN messages m ON m.id=t.result_message_id WHERE t.source_message_id=$1`,
					[message.id],
				)
			).rows[0],
	);
	if (expectError) assert.equal(result.content.type, "error");
	else
		assert.notEqual(
			result.content.type,
			"error",
			`worker result error: ${redactError(result.content.text ?? result.content.type)}; diagnostics: ${redactError(output.join("").slice(-1500))}`,
		);
	await until(async () => (await state()).completed > before.completed);
	await pause(30);
	const after = await state();
	report.rounds.push({ bot: bot.id, queries: after.queries - before.queries, active: after.active, rss: after.rss });
	assert.ok(after.active <= 20 && after.highWater <= 20, "active Bot cap exceeded");
	assert.equal(
		(
			await backend.pool.query("SELECT count(*)::int AS n FROM messages WHERE conv_id=$1 AND sender_id=$2", [
				bot.conv,
				bot.id,
			])
		).rows[0].n,
		previousMessages + 1,
	);
	assert.equal(
		(
			await backend.pool.query(
				"SELECT count(*)::int AS n FROM cloud_bot_turns WHERE source_message_id=$1 AND result_message_id=$2",
				[message.id, result.id],
			)
		).rows[0].n,
		1,
	);
	return { message, result };
}
try {
	const bots = await Promise.all(Array.from({ length: load ? 100 : card ? 1 : 2 }, createBot));
	await start();
	if (card && transport) {
		const bot = bots[0];
		const { ensureCloudDefinition } = await import("../../packages/cloud-host/dist/definitions.js");
		const environment = await readFile(
			new URL("../../packages/cloud-host/prompts/environment.md", import.meta.url),
			"utf8",
		);
		const config = await ensureCloudDefinition(
			backend.pool,
			{ id: bot.id, name: "小未", ownerId: bot.owner.id },
			environment,
		);
		config.retry = { maxRetries: 0 };
		config.timeouts = { firstTokenMs: 5000, totalMs: 15000 };
		await backend.pool.query("UPDATE bot_files SET content=$4 WHERE tenant_id=$1 AND bot_id=$2 AND path=$3", [
			bot.owner.id,
			bot.id,
			"yonder.yaml",
			JSON.stringify(config),
		]);
		const path = `agents/${bot.id}/agent.yaml`;
		const agent = JSON.parse(
			(
				await backend.pool.query("SELECT content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path=$3", [
					bot.owner.id,
					bot.id,
					path,
				])
			).rows[0].content,
		);
		agent.profiles.default.fallback = { models: [], hold: 0 };
		await backend.pool.query("UPDATE bot_files SET content=$4 WHERE tenant_id=$1 AND bot_id=$2 AND path=$3", [
			bot.owner.id,
			bot.id,
			path,
			JSON.stringify(agent),
		]);
	}
	if (card) {
		assert.equal(load, false);
		const bot = bots[0];
		let preparedCalls = 0;
		if (transport) {
			transport.mode("empty");
			transport.tool((_body, { toolResult }) => {
				if (toolResult) return undefined;
				preparedCalls++;
				return {
					name: "channel-card_reply_card",
					arguments: JSON.stringify({
						title: "接入与安装",
						body: "选择入口",
						actions: [
							{ id: "connect", label: "接入设备", link: "/connect" },
							{ id: "download", label: "安装客户端", link: "/download" },
						],
					}),
				};
			});
		}
		const { result } = await turn(
			bot,
			"我想接入自己的设备，还需要安装客户端。请准备一张交互卡片，卡片中给我接入设备和下载客户端两个各自可点击的应用内按钮，然后正常完成本轮。",
		);
		assert.equal(result.content.type, "interactive");
		assert.equal(result.content.state, "pending");
		assert.ok(result.content.actions.some((action) => action.link === "/connect"));
		assert.ok(result.content.actions.some((action) => action.link === "/download"));
		const commits = (
			await backend.pool.query("SELECT writes FROM bot_runtime_commits WHERE tenant_id=$1 AND bot_id=$2", [
				bot.owner.id,
				bot.id,
			])
		).rows;
		assert.equal(JSON.stringify(commits).includes("channel-card_reply_card"), true);
		const intents = () =>
			backend.pool.query(
				"SELECT path FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='channel-card' AND path LIKE 'replies/%' AND kind='file'",
				[bot.owner.id, bot.id],
			);
		await until(async () => (await intents()).rowCount === 0);
		report.card = {
			content: result.content,
			toolInNativeTranscript: true,
			uniqueResult: true,
			intentClearedAfterAttempt: true,
			emptyFinal: !live,
		};
		if (transport) {
			transport.mode("tool-then-503");
			transport.clear();
			const failed = await turn(bot, "Prepare a final card, then transport-test failure.", true);
			assert.ok(failed.result.content.text.includes("503"), redactError(failed.result.content.text));
			assert.equal(preparedCalls, 2);
			assert.equal(JSON.stringify(transport.requests()).includes("已准备"), true);
			await until(async () => (await intents()).rowCount === 0);
			report.card.failureAfterPreparation = {
				type: failed.result.content.type,
				noCardDelivered: true,
				intentCleared: true,
			};
			transport.tool(undefined);
			transport.mode("reply");
			transport.clear();
			const next = await turn(bot, "Reply briefly after the failed card preparation.");
			assert.notEqual(next.result.content.type, "interactive");
			const messages = JSON.stringify(transport.requests());
			assert.equal(messages.includes(failed.result.content.text), false);
			assert.equal(messages.includes("transport-test HTTP 503"), false);
			report.card.failureAfterPreparation.laterPromptExcludesError = true;
			report.card.failureAfterPreparation.nextReplyDoesNotReuseCard = true;
		}
		const key = (await readFile(modelKeyFile, "utf8")).trim();
		const stored = (await backend.pool.query("SELECT row_to_json(t) AS data FROM bot_runtime_commits t")).rows;
		assert.equal(JSON.stringify(stored).includes(key), false);
		assert.equal(output.join("").includes(key), false);
		report.keyAbsentFromLogsAndTranscript = true;
		console.log(JSON.stringify(report, null, 2));
	} else if (scenario) {
		assert.ok(!live && !load, "failure scenarios use only the explicit local transport");
		const { ensureCloudDefinition } = await import("../../packages/cloud-host/dist/definitions.js");
		const environment = await readFile(
			new URL("../../packages/cloud-host/prompts/environment.md", import.meta.url),
			"utf8",
		);
		const bot = bots[0];
		const config = await ensureCloudDefinition(
			backend.pool,
			{ id: bot.id, name: "小未", ownerId: bot.owner.id },
			environment,
		);
		config.retry = { maxRetries: 0 };
		config.timeouts =
			scenario === "interrupt" ? { firstTokenMs: 5000, totalMs: 15000 } : { firstTokenMs: 150, totalMs: 500 };
		await backend.pool.query("UPDATE bot_files SET content=$4 WHERE tenant_id=$1 AND bot_id=$2 AND path=$3", [
			bot.owner.id,
			bot.id,
			"yonder.yaml",
			JSON.stringify(config),
		]);
		const path = `agents/${bot.id}/agent.yaml`;
		const agent = JSON.parse(
			(
				await backend.pool.query("SELECT content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path=$3", [
					bot.owner.id,
					bot.id,
					path,
				])
			).rows[0].content,
		);
		agent.profiles.default.fallback = { models: [], hold: 0 };
		agent.profiles.default.tools = { offer: ["message_send"], search: [] };
		if (scenario === "reply-none") {
			const ownerBinding = agent.bindings.find((binding) => binding.id === "owner");
			assert.ok(ownerBinding);
			ownerBinding.reply = "none";
		}
		await backend.pool.query("UPDATE bot_files SET content=$4 WHERE tenant_id=$1 AND bot_id=$2 AND path=$3", [
			bot.owner.id,
			bot.id,
			path,
			JSON.stringify(agent),
		]);
		if (scenario === "reply-none") {
			const text = "本轮来源关闭自动回复，未投递模型回复";
			const first = await turn(bot, "First input with automatic replies disabled.", true);
			assert.deepEqual(first.result.content, { type: "error", text });
			transport.clear();
			const second = await turn(bot, "Second input after the previous reply-disabled result.", true);
			assert.deepEqual(second.result.content, { type: "error", text });
			assert.equal(JSON.stringify(transport.requests()).includes(text), false);
			const final = await state();
			assert.equal(final.completed, 2);
			assert.equal(final.pendingSources, 0);
			report.replyNone = {
				results: 2,
				type: "error",
				completed: final.completed,
				pendingSources: final.pendingSources,
				laterPromptExcludesError: true,
			};
			console.log(JSON.stringify(report, null, 2));
		} else if (scenario === "interrupt") {
			transport.mode("hold");
			const firstInput = await backend.request(`/api/conversations/${bot.conv}/messages`, bot.owner, {
				content: { type: "text", text: "Interrupt a running model request." },
			});
			await until(() => transport.requests().length === 1);
			const queuedInput = await backend.request(`/api/conversations/${bot.conv}/messages`, bot.owner, {
				content: { type: "text", text: "This queued input must not start after disconnect." },
			});
			await until(async () => (await state()).pendingSources === 2);
			const beforeClose = Date.now();
			await stop();
			const closeMs = Date.now() - beforeClose;
			const results = await until(async () => {
				const rows = (
					await backend.pool.query(
						"SELECT m.content FROM cloud_bot_turns t JOIN messages m ON m.id=t.result_message_id WHERE t.source_message_id=ANY($1::uuid[])",
						[[firstInput.id, queuedInput.id]],
					)
				).rows;
				return rows.length === 2 ? rows : undefined;
			});
			assert.deepEqual(
				results.map((row) => row.content.type),
				["error", "error"],
			);
			assert.equal(
				(
					await backend.pool.query("SELECT count(*)::int AS n FROM messages WHERE conv_id=$1 AND sender_id=$2", [
						bot.conv,
						bot.id,
					])
				).rows[0].n,
				2,
			);
			assert.equal(transport.requests().length, 1);
			report.interruption = {
				sources: 2,
				modelRequests: 1,
				resultTypes: results.map((row) => row.content.type),
				closeMs,
				queuedSourceNotExecuted: true,
			};
			console.log(JSON.stringify(report, null, 2));
		} else {
			transport.mode(scenario);
			const first = await turn(bot, "Transport failure probe.", true);
			const error = first.result.content.text;
			if (scenario.includes("503")) assert.ok(error.includes("503"));
			if (scenario === "timeout") assert.ok(/超时|timeout|timed out/i.test(error));
			if (scenario === "empty") assert.ok(/空|内容/.test(error));
			if (scenario === "send-then-503")
				assert.ok(JSON.stringify(transport.requests()).includes("本渠道只投递本轮最终结果"));
			const key = (await readFile(modelKeyFile, "utf8")).trim();
			const commits = (await backend.pool.query("SELECT row_to_json(t) AS data FROM bot_runtime_commits t")).rows;
			assert.equal(JSON.stringify(commits).includes(key), false);
			assert.equal(output.join("").includes(key), false);
			transport.mode("reply");
			transport.clear();
			await turn(bot, "Reply briefly after the failure.");
			const messages = JSON.stringify(transport.requests());
			assert.equal(messages.includes(error), false);
			assert.equal(messages.includes("transport-test HTTP 503"), false);
			report.failure = {
				scenario,
				type: first.result.content.type,
				text: error,
				oneResult: true,
				laterPromptExcludesError: true,
				keyAbsent: true,
			};
			console.log(JSON.stringify(report, null, 2));
		}
	} else {
		const soul = await readFile(
			new URL("../../plugins/agent-presets/prompts/default-agent/SOUL.md", import.meta.url),
			"utf8",
		);
		for (let index = 0; index < bots.length; index++) {
			const bot = bots[index];
			const marker = `PG-SOUL-${randomUUID()}`;
			await backend.pool.query(
				`INSERT INTO bot_files(tenant_id,bot_id,path,content) VALUES($1,$2,$3,$4)
			ON CONFLICT(tenant_id,bot_id,path) DO UPDATE SET content=EXCLUDED.content`,
				[bot.owner.id, bot.id, `agents/${bot.id}/SOUL.md`, `${soul}\n\nVerification source token: ${marker}\n`],
			);
			const watched = new Promise((done) => {
				const listener = (message) => {
					if (message.type === "token-watched") {
						child.off("message", listener);
						done();
					}
				};
				child.on("message", listener);
			});
			child.send({ type: "watch-token", token: marker });
			await watched;
			const { result } = await turn(bot, "请逐字回答 SOUL.md 里的 Verification source token，不要附加解释。");
			const profiles = (
				await backend.pool.query("SELECT profile,mode FROM bot_sessions WHERE tenant_id=$1 AND bot_id=$2", [
					bot.owner.id,
					bot.id,
				])
			).rows;
			const inspected = modelInputs.splice(0);
			console.log(
				JSON.stringify({
					phase: "source-diagnostic",
					bot: index + 1,
					profiles,
					modelInputs: inspected,
					...(live ? { reply: redactError(result.content.text) } : {}),
				}),
			);
			assert.ok(
				inspected.some((input) => input.markerPresent),
				"PG SOUL token did not enter provider messages",
			);
			assert.notEqual(result.content.type, "error", `turn failed: ${result.content.text}`);
			if (live) assert.ok(result.content.text.includes(marker), "real reply did not use the PG SOUL source token");
			report.results.push({
				bot: index + 1,
				type: result.content.type,
				...(live ? { reply: result.content.text, soulTokenMatched: true } : {}),
			});
		}
		const warm = await turn(bots.at(-1), "请简短回应这一轮，不调用工具。");
		report.warm = { type: warm.result.content.type, queries: report.rounds.at(-1).queries };
		await pause(500);
		const final = await state();
		report.final = final;
		report.rssPeakBytes = Math.max(...rssSamples);
		report.rssPeakMB = report.rssPeakBytes / 1_000_000;
		assert.ok(report.rssPeakBytes <= 350_000_000, `peak RSS exceeds 350 MB: ${report.rssPeakBytes}`);
		assert.ok(final.rss <= 350_000_000, `loaded RSS exceeds 350 MB: ${final.rss}`);
		const [first, second] = bots;
		const { createPostgresBotSource } = await import("../../packages/cloud-host/dist/source.js");
		const { createPostgresPluginStorage } = await import("../../packages/cloud-host/dist/plugin-storage.js");
		const a = createPostgresBotSource(backend.pool, first.owner.id, first.id);
		const b = createPostgresBotSource(backend.pool, second.owner.id, second.id);
		const secretPath = `agents/${first.id}/isolation.txt`;
		await a.home.files.writeFile(secretPath, "tenant-isolation-check");
		assert.equal(await b.home.files.exists(secretPath), false);
		const filesA = createPostgresPluginStorage(backend.pool, first.owner.id, first.id, "tasks").open();
		const filesB = createPostgresPluginStorage(backend.pool, second.owner.id, second.id, "tasks").open();
		await filesA.write("isolation.txt", "tenant-isolation-check");
		assert.equal(await filesB.read("isolation.txt"), undefined);
		const rows = (
			await backend.pool.query("SELECT tenant_id,bot_id,agent FROM bot_sessions WHERE bot_id=ANY($1::text[])", [
				[first.id, second.id],
			])
		).rows;
		assert.ok(rows.some((row) => row.tenant_id === first.owner.id && row.agent === first.id));
		assert.ok(rows.some((row) => row.tenant_id === second.owner.id && row.agent === second.id));
		const { createPostgresStore } = await import("../../packages/cloud-host/dist/store/postgres.js");
		const storeA = createPostgresStore(backend.pool, first.owner.id, first.id);
		const storeB = createPostgresStore(backend.pool, second.owner.id, second.id);
		const sessionA = (await storeA.sessions.list())[0];
		const sessionB = (await storeB.sessions.list())[0];
		assert.equal((await storeA.sessions.get(sessionB.id))?.agent === second.id, false);
		assert.equal((await storeB.sessions.get(sessionA.id))?.agent === first.id, false);
		assert.equal(await storeA.sessions.find(second.id, sessionB.key), undefined);
		assert.equal(await storeB.sessions.find(first.id, sessionA.key), undefined);
		report.isolation = { tenants: 2, virtualFiles: true, sessionGetAndFind: true, pluginFiles: true };
		if (!live && !load) {
			await backend.pool.query("UPDATE accounts SET public=true WHERE id=$1", [first.id]);
			const dm = await backend.request("/api/conversations/dm", second.owner, { actorId: first.id });
			const privateSoul = await a.home.files.readFile(`agents/${first.id}/SOUL.md`);
			const token = privateSoul.match(/PG-SOUL-[a-f0-9-]+/)?.[0];
			assert.ok(token);
			transport.clear();
			await turn({ owner: second.owner, id: first.id, conv: dm.id }, "Say hello briefly.");
			assert.equal(JSON.stringify(transport.requests()).includes(token), false);
			const visitor = (await storeA.sessions.list()).find((session) => session.profile === "outsider");
			assert.ok(visitor);
			assert.equal(await storeB.sessions.get(visitor.id), undefined);
			report.visitor = {
				publicDm: true,
				profile: visitor.profile,
				privateSoulAbsentFromRequest: true,
				foreignSessionGet: "undefined",
			};
		}
		if (live) {
			const key = (await readFile(modelKeyFile, "utf8")).trim();
			const stored = (await backend.pool.query("SELECT row_to_json(t) AS data FROM bot_runtime_commits t")).rows;
			assert.equal(JSON.stringify(stored).includes(key), false);
			assert.equal(output.join("").includes(key), false);
			report.keyAbsentFromLogsAndTranscript = true;
		}
		console.log(JSON.stringify(report, null, 2));
	}
} finally {
	await stop();
	await transport?.close();
	await backend.close();
	await rm(folder, { recursive: true, force: true });
}
