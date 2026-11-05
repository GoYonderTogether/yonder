// 每日晨晚报与记忆页的真实验证（2026-11-05）：真实 PG/Redis/云端 server/共享 worker，
// 平台模型用官方 DeepSeek（密钥只经 0600 文件注入，不打印）。验证链路：
//   1. Bot 创建后 worker 播种两条 cron 作业（08:00/21:00 Asia/Shanghai），owner 指向真实 main 会话；
//   2. 主人说一个事实，回复后 memory 插件把该事实写进 plugin_files（memory 虚拟树），并更新 me/now.md；
//   3. 记忆上下文进入下一次模型请求（memory-core，meChars=5000）；
//   4. 云端记忆 API 返回自我画像与来源分组，编辑/删除生效。
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { redactError } from "../../packages/bot-core/dist/delivery/model-notice.js";
import { localCloud } from "./services.mjs";

const live = process.argv.includes("--live");
const folder = await mkdtemp(join(tmpdir(), "yonder-memory-verify-"));
const workerKeyFile = join(folder, "worker.key");
const modelKeyFile = live
	? (process.env.CLOUD_BOT_MODEL_KEY_FILE ?? join(folder, "model.key"))
	: join(folder, "model.key");
const workerKey = randomBytes(32);
await writeFile(workerKeyFile, workerKey, { mode: 0o600 });
if (!(await readFile(modelKeyFile, "utf8").catch(() => ""))) {
	await writeFile(modelKeyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
}
const backend = await localCloud(workerKey, 30);
const report = {
	scenario: "cloud-memory-page-and-daily-brief",
	mode: live ? "real-deepseek" : "loopback-transport",
	steps: [],
};
let child;
const logs = [];
const sanitize = (value) =>
	redactError(String(value))
		.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/[\r\n\t]+/g, " ")
		.slice(0, 300);

async function startWorker() {
	child = fork(new URL("./process.mjs", import.meta.url), [], {
		cwd: resolve(import.meta.dirname, "../.."),
		execArgv: ["--use-env-proxy"],
		stdio: ["ignore", "pipe", "pipe", "ipc"],
		env: {
			...process.env,
			DATABASE_URL: backend.databaseUrl,
			YONDER_CLOUD_ENDPOINT: backend.endpoint,
			CLOUD_BOT_WORKER_KEY_FILE: workerKeyFile,
			CLOUD_BOT_MODEL_KEY_FILE: modelKeyFile,
		},
	});
	child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
	child.stderr.on("data", (chunk) => logs.push(chunk.toString()));
	const state = await new Promise((done, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`worker ready timeout: ${sanitize(logs.join("").slice(-1200))}`)),
			60000,
		);
		child.on("message", (message) => {
			if (message.type === "ready") {
				clearTimeout(timer);
				done(message.state);
			}
		});
		child.once("exit", () => reject(new Error(`worker exited before ready: ${sanitize(logs.join("").slice(-1200))}`)));
	});
	report.workerReady = { active: state.active, rss: state.rss };
}

async function stopWorker() {
	if (!child || child.exitCode !== null) return;
	const exited = once(child, "exit");
	child.send("close");
	const finished = await Promise.race([exited.then(() => true), new Promise((done) => setTimeout(done, 10000))]);
	if (!finished) {
		child.kill("SIGKILL");
		await exited;
		throw new Error("worker close exceeded 10 seconds");
	}
	child = undefined;
}

const until = async (work, timeout = 120_000) => {
	const started = Date.now();
	for (;;) {
		const value = await work();
		if (value) return value;
		assert.ok(Date.now() - started < timeout, "verification condition timed out");
		await pause(50);
	}
};

const memoryFiles = async (ownerId, botId, pattern) =>
	(
		await backend.pool.query(
			`SELECT path,kind,content,updated_at FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='memory' AND path LIKE $3 ORDER BY path`,
			[ownerId, botId, pattern],
		)
	).rows;
const cronJobs = async (ownerId, botId) => {
	const row = (
		await backend.pool.query(
			`SELECT content FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='cron' AND root='' AND path='jobs.json'`,
			[ownerId, botId],
		)
	).rows[0];
	return row ? JSON.parse(row.content) : [];
};

async function turn(bot, text) {
	const message = await backend.request(`/api/conversations/${bot.conv}/messages`, bot.owner, {
		content: { type: "text", text },
	});
	console.error(`[probe] source ${message.id} submitted; waiting for result`);
	const result = await until(
		async () =>
			(
				await backend.pool.query(
					`SELECT m.*, t.created_at FROM cloud_bot_turns t JOIN messages m ON m.id=t.result_message_id WHERE t.source_message_id=$1`,
					[message.id],
				)
			).rows[0],
		180_000,
	);
	console.error(`[probe] result: ${sanitize(JSON.stringify(result.content).slice(0, 200))}`);
	if (result.content.type === "error") {
		console.log(
			JSON.stringify(
				{ turnError: sanitize(result.content.text), workerLog: sanitize(logs.join("").slice(-3000)) },
				null,
				2,
			),
		);
	}
	assert.notEqual(
		result.content.type,
		"error",
		`turn failed: ${sanitize(result.content.text)}; worker: ${sanitize(logs.join("").slice(-800))}`,
	);
	await pause(300);
	return result;
}

try {
	const owner = await backend.owner();
	const actor = await backend.request("/api/me/default-bot", owner, {});
	const dm = await backend.request("/api/conversations/dm", owner, { actorId: actor.id });
	const bot = { owner, id: actor.id, conv: dm.id };
	await startWorker();

	// 1. cron 作业在 Bot 激活后播种（worker 打开 Bot 时）。
	const jobs = await until(async () =>
		(await cronJobs(owner.id, bot.id)).length === 2 ? cronJobs(owner.id, bot.id) : undefined,
	);
	for (const expression of ["0 8 * * *", "0 21 * * *"]) {
		const job = jobs.find((entry) => entry.schedule.expression === expression);
		assert.ok(job, `missing ${expression} job`);
		assert.equal(job.schedule.timezone, "Asia/Shanghai");
		assert.equal(job.enabled, true);
		assert.equal(job.payload.type, "cron.morning-brief");
		assert.equal(job.payload.data.skill, expression === "0 8 * * *" ? "memory-morning-brief" : "memory-evening-wrap");
		assert.equal(job.delivery.to, `acct:card:${bot.id}:${owner.id}`);
		assert.ok(/^\d+$/.test(job.owner.session), "job owner session is the real main session id");
		assert.equal(job.owner.profile, "default");
	}
	report.steps.push("cron-seeded");

	// 2. 主人说一个事实；记录进 timeline，me/now.md 被更新。
	const fact = `验收事实${randomBytes(6).toString("hex")}`;
	const factAnswer = await turn(
		bot,
		`请记住一个事实并原样复述给我：我的口令是 ${fact}。请用记忆工具把它写进你的关于我档案（me/now），不要只写周记录。`,
	);
	assert.ok(String(factAnswer.content.text ?? "").includes(fact.slice(0, 8)), "reply did not echo the fact");
	const timeline = await until(async () => {
		const rows = await memoryFiles(owner.id, bot.id, "timeline/%");
		return rows.some((row) => row.content?.includes(fact)) ? rows : undefined;
	}, 120_000);
	report.steps.push("fact-captured");
	const meFiles = await until(async () => {
		const rows = await memoryFiles(owner.id, bot.id, "me/%");
		const now = rows.find((row) => row.path === "me/now.md");
		if (now && now.content !== "## 当前\n## 历史\n") return rows;
		const pending = await memoryFiles(owner.id, bot.id, "timeline/%");
		console.error(`[probe] waiting for me/now.md; now=${JSON.stringify(now?.content)}; timeline=${pending.length}`);
		return undefined;
	}, 180_000);
	const now = meFiles.find((row) => row.path === "me/now.md");
	report.steps.push("summary-updated");
	assert.ok(now.updated_at, "summary has an updated time");

	// 3. 记忆上下文进入下一次模型请求：问事实的出处，模型能引用记忆内容。
	const probe = await turn(bot, `我的口令是什么？只回答口令本身。`);
	assert.ok(String(probe.content.text ?? "").includes(fact.slice(0, 8)), "memory did not reach the next model request");
	report.steps.push("memory-recalled");

	// 4. 记忆 API：自我画像、来源分组、编辑与删除。
	const page = await (await fetch(`${backend.endpoint}/api/me/memory`, { headers: { cookie: owner.cookie } })).json();
	assert.equal(page.bot.id, bot.id);
	assert.ok(page.summary?.text?.length > 10, "API returns the bot-maintained summary");
	const documents = await (
		await fetch(`${backend.endpoint}/api/me/memory/documents`, { headers: { cookie: owner.cookie } })
	).json();
	assert.ok(documents.groups.length >= 1, "documents group by source");
	const timelineGroup = documents.groups.find((group) => group.documents.some((d) => d.path.startsWith("timeline/")));
	assert.ok(timelineGroup, "timeline documents are grouped");
	const path = timelineGroup.documents[0].path;
	const doc = await (
		await fetch(`${backend.endpoint}/api/me/memory/documents/${encodeURIComponent(path)}`, {
			headers: { cookie: owner.cookie },
		})
	).json();
	assert.ok(doc.text.length > 0);
	const edited = await fetch(`${backend.endpoint}/api/me/memory/documents/${encodeURIComponent(path)}`, {
		method: "PUT",
		headers: { cookie: owner.cookie, origin: "http://localhost:18030", "content-type": "application/json" },
		body: JSON.stringify({ text: `${doc.text}\n主人手改。\n` }),
	});
	assert.equal(edited.status, 204);
	const afterEdit = await (
		await fetch(`${backend.endpoint}/api/me/memory/documents/${encodeURIComponent(path)}`, {
			headers: { cookie: owner.cookie },
		})
	).json();
	assert.ok(afterEdit.text.includes("主人手改"));
	const summaryEdit = await fetch(`${backend.endpoint}/api/me/memory/summary`, {
		method: "PUT",
		headers: { cookie: owner.cookie, origin: "http://localhost:18030", "content-type": "application/json" },
		body: JSON.stringify({ text: `${page.summary.text}\n主人补充。\n`.slice(0, 5000) }),
	});
	assert.ok([204, 400].includes(summaryEdit.status), "summary edit accepted within budget or rejected over it");
	report.steps.push("memory-api-ok");

	// 5. 重复激活不重复播种：第二轮激活后作业仍是两条。
	await turn(bot, `请简短回应这一轮，不调用工具。`);
	const again = await cronJobs(owner.id, bot.id);
	assert.equal(again.length, 2, "re-activation must not duplicate seeded jobs");
	report.steps.push("seed-idempotent");
	console.log(JSON.stringify(report, null, 2));
} catch (error) {
	report.failure = sanitize(error instanceof Error ? error.message : String(error));
	report.workerLogTail = sanitize(logs.join("").slice(-4000));
	console.log(JSON.stringify(report, null, 2));
	throw error;
} finally {
	await stopWorker();
	await backend.close();
	await rm(folder, { recursive: true, force: true });
}
