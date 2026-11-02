import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { redactError } from "../../packages/bot-core/dist/delivery/model-notice.js";
import { migrateCloudWorker } from "../../packages/cloud-host/dist/worker.js";
import { deviceRunCatalogue } from "./device-run-catalog.mjs";
import { localCloud } from "./services.mjs";
import { modelTransport } from "./transport.mjs";

const program = process.argv.includes("--program");
if (!process.argv.includes("--live") && !program)
	throw new Error("Usage: node scripts/cloud-worker/device.mjs --live | --program");

const root = resolve(import.meta.dirname, "../..");
process.chdir(root);
const folder = await mkdtemp(join(tmpdir(), "yonder-worker-device-"));
const workerKey = randomBytes(32);
const workerKeyFile = join(folder, "worker.key");
const modelKeyFile = program ? join(folder, "model.key") : join(homedir(), ".config/yonder/cloud-bot-model.key");
await writeFile(workerKeyFile, workerKey, { mode: 0o600 });
if (program) await writeFile(modelKeyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
let backend;
let transport;
const home = join(folder, "device-home");
const memoryRoot = join(folder, "official-device-memory");
const marker = `DEVICE-MEMORY-${randomBytes(24).toString("hex")}`;
const offlineMarker = `OFFLINE-MEMORY-${randomBytes(24).toString("hex")}`;
const children = new Set();
const childLogs = new WeakMap();
let worker;
let device;
const workerKeyEncoded = workerKey.toString("base64url");

function safeReason(value) {
	return redactError(String(value))
		.replace(/[\r\n\t]+/g, " ")
		.slice(0, 300);
}

function childReason(child) {
	return (childLogs.get(child) ?? []).slice(-3).join(" | ");
}

async function until(work, timeout = 120_000) {
	const started = Date.now();
	for (;;) {
		const value = await work();
		if (value) return value;
		assert.ok(Date.now() - started < timeout, "device verification condition timed out");
		await pause(25);
	}
}

function spawn(script, env) {
	const child = fork(new URL(script, import.meta.url), [], {
		cwd: root,
		execArgv: ["--use-env-proxy"],
		stdio: ["ignore", "pipe", "pipe", "ipc"],
		env: { ...process.env, ...env, ...(program && transport ? { TEST_MODEL_BASE_URL: transport.baseUrl } : {}) },
	});
	children.add(child);
	const output = [];
	childLogs.set(child, output);
	for (const stream of [child.stdout, child.stderr]) {
		let pending = "";
		stream.on("data", (chunk) => {
			pending += chunk.toString();
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				output.push(safeReason(line));
				if (output.length > 20) output.shift();
			}
		});
		stream.on("end", () => {
			if (pending.trim()) output.push(safeReason(pending));
		});
	}
	return child;
}

function waitMessage(child, predicate, timeout = 120_000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => finish(new Error(`child process timed out${childReason(child) ? `: ${childReason(child)}` : ""}`)),
			timeout,
		);
		const onMessage = (message) => {
			if (predicate(message)) finish(undefined, message);
		};
		const onExit = () =>
			finish(new Error(`child process exited unexpectedly${childReason(child) ? `: ${childReason(child)}` : ""}`));
		function finish(error, value) {
			clearTimeout(timer);
			child.off("message", onMessage);
			child.off("exit", onExit);
			if (error) reject(error);
			else resolve(value);
		}
		child.on("message", onMessage);
		child.once("exit", onExit);
	});
}

async function stop(child) {
	if (!child || !children.has(child)) return;
	if (child.exitCode !== null || child.signalCode !== null) {
		children.delete(child);
		return;
	}
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
	}
	children.delete(child);
	if (!closed) throw new Error("child process close exceeded 10 seconds");
}

async function startDevice() {
	await mkdir(join(home, "agents/main"), { recursive: true });
	await mkdir(join(memoryRoot, "mine"), { recursive: true });
	await writeFile(
		join(memoryRoot, "mine/travel.md"),
		`东京旅行记录：行程识别码为 ${marker}。此文件属于本次临时设备验收的官方记忆根。\n`,
	);
	await writeFile(
		join(home, "yonder.yaml"),
		JSON.stringify({
			schema: 1,
			locale: "zh-CN",
			timezone: "UTC",
			defaultModel: "rightapi-glm/glm-5.3-flash",
			models: {
				chain: [],
				providers: {
					"rightapi-glm": {
						baseUrl: "http://127.0.0.1:1/v1",
						api: "openai-completions",
						authHeader: true,
						models: [{ id: "glm-5.3-flash" }],
					},
				},
			},
			plugins: [
				{ use: "@yonder/plugin-channel-card" },
				{
					use: "@yonder/plugin-memory",
					config: {
						root: memoryRoot,
						owner: "person:device-owner",
						timezone: "UTC",
						allowedAgents: ["main"],
						triggers: { bootstrap: false, inbox: false },
					},
				},
			],
			channels: { card: { type: "card", endpoint: backend.endpoint } },
			agents: [{ id: "main", workspace: "agents/main" }],
			identity: { persons: [{ id: "device-owner", name: "Temporary owner", accounts: [] }] },
		}),
	);
	await writeFile(
		join(home, "agents/main/agent.yaml"),
		JSON.stringify({
			schema: 1,
			id: "main",
			name: "Temporary memory device",
			owner: "person:device-owner",
			defaultProfile: "default",
			profiles: {
				default: {
					model: "rightapi-glm/glm-5.3-flash",
					capabilities: ["read", "admin"],
					plugins: ["memory"],
					contexts: ["memory-core"],
					tools: { offer: ["memory_search", "memory_read"], search: [] },
					channelInstances: ["card"],
				},
			},
			bindings: [
				{
					id: "owner",
					match: { channel: "card", kind: "dm", from: "owner" },
					session: "main",
					profile: "default",
					wake: "run",
					reply: "auto",
				},
			],
		}),
	);
	device = spawn("./device-process.mjs", { CLOUD_DEVICE_HOME: home });
	const ready = await waitMessage(device, (message) => message.type === "ready" || message.type === "fatal");
	assert.equal(
		ready.type,
		"ready",
		`device process failed: ${safeReason(ready.reason ?? childReason(device) ?? "unknown failure")}`,
	);
}

async function loginDevice(owner) {
	const inviteResponse = await backend.request("/api/device/invite", owner, {});
	const { code } = inviteResponse;
	assert.match(code, /^\d{10}$/);
	const loggedIn = waitMessage(device, (message) => message.type === "login");
	device.send({ type: "login", code });
	const login = await loggedIn;
	assert.equal(login.status, "connected", `device login failed: ${safeReason(login.reason ?? "unknown failure")}`);
	const row = await until(
		async () =>
			(
				await backend.pool.query(
					`SELECT d.id AS device_id,a.id AS agent_id
				 FROM devices d
			 JOIN sessions s ON s.device_id=d.id AND s.account_id=d.owner_id AND s.kind='device'
			 JOIN device_agents da ON da.device_id=d.id AND da.retired_at IS NULL
			 JOIN accounts a ON a.id=da.account_id AND a.enabled AND a.owner_id=d.owner_id AND a.device_id=d.id
			 WHERE d.owner_id=$1`,
					[owner.id],
				)
			).rows[0],
	);
	await until(() => backend.hub.isDeviceConnected(row.device_id));
	assert.ok(row.agent_id);
	return row;
}

async function startWorker() {
	worker = spawn("./process.mjs", {
		DATABASE_URL: backend.databaseUrl,
		YONDER_CLOUD_ENDPOINT: backend.endpoint,
		CLOUD_BOT_WORKER_KEY_FILE: workerKeyFile,
		CLOUD_BOT_MODEL_KEY_FILE: modelKeyFile,
	});
	await waitMessage(worker, (message) => message.type === "ready", 60_000);
}

async function createBot(owner) {
	const bot = await backend.request("/api/me/default-bot", owner, {});
	const conversation = await backend.request("/api/conversations/dm", owner, { actorId: bot.id });
	const { ensureCloudDefinition } = await import("../../packages/cloud-host/dist/definitions.js");
	const environment = await readFile(
		new URL("../../packages/cloud-host/prompts/environment.md", import.meta.url),
		"utf8",
	);
	await ensureCloudDefinition(
		backend.pool,
		{ id: bot.id, name: bot.name ?? "Temporary Bot", ownerId: owner.id },
		environment,
	);
	return { id: bot.id, conversation: conversation.id };
}

async function turn(owner, bot, text) {
	const source = await backend.request(`/api/conversations/${bot.conversation}/messages`, owner, {
		content: { type: "text", text },
	});
	const result = await until(
		async () =>
			(
				await backend.pool.query(
					`SELECT m.* FROM cloud_bot_turns t JOIN messages m ON m.id=t.result_message_id
					 WHERE t.source_message_id=$1`,
					[source.id],
				)
			).rows[0],
	);
	return { source, result };
}

async function deviceSnapshot() {
	const snapshot = waitMessage(device, (message) => message.type === "snapshot");
	device.send({ type: "snapshot" });
	return snapshot;
}

function memoryTool(body) {
	return (body.tools ?? []).find(
		(entry) =>
			entry.type === "function" &&
			typeof entry.function?.name === "string" &&
			entry.function.name.endsWith("_memory_search") &&
			entry.function.parameters?.properties?.terms,
	);
}

function deviceToolNames(body) {
	return (body.tools ?? [])
		.filter((entry) => entry.type === "function" && entry.function?.name?.startsWith("device_"))
		.map((entry) => entry.function.name)
		.sort();
}

function latestUserText(body) {
	const message = [...(body.messages ?? [])].reverse().find((entry) => entry.role === "user");
	return typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
}

function toolResultContains(requests, requestMarker, value) {
	return requests.some(
		(request) =>
			JSON.stringify(request.messages).includes(requestMarker) &&
			request.messages.some((message) => message.role === "tool" && JSON.stringify(message.content).includes(value)),
	);
}

try {
	backend = await localCloud(workerKey, 30);
	await migrateCloudWorker(backend.pool);
	await startDevice();
	const owner = await backend.owner();
	const bot = await createBot(owner);
	const deviceRow = await loginDevice(owner);
	if (program) transport = await modelTransport();
	await startWorker();
	const onlineQueryMarker = `online-probe-${randomBytes(12).toString("hex")}`;
	const onlinePrompt = `本次验收标记 ${onlineQueryMarker}。请使用我已授权设备上的官方记忆插件，查找东京旅行记录里的行程识别码，并准确告诉我查到的值。只依据实际读取到的记录，不要猜测。`;
	let cronRequestMarker;
	let cronProgramMarker;
	let cronCreateSourceId;
	let phase = "online";
	let actualMemorySchemaObserved = false;
	const providerCatalogues = { online: [], cronCreate: [], cronRun: [], offline: [] };
	if (program) {
		cronRequestMarker = `cron-create-${randomBytes(12).toString("hex")}`;
		cronProgramMarker = `cron-program-${randomBytes(12).toString("hex")}`;
		transport.tool((body, { toolResult }) => {
			const lastUser = latestUserText(body);
			providerCatalogues[phase].push(deviceToolNames(body));
			if (phase === "cronCreate" && !toolResult && lastUser.includes(cronRequestMarker)) {
				const cron = (body.tools ?? []).find(
					(entry) =>
						entry.type === "function" &&
						entry.function?.name === "cron_manage" &&
						entry.function.parameters?.properties?.job,
				);
				if (!cron) return undefined;
				const at = new Date(Date.now() + 15_000).toISOString();
				return {
					name: cron.function.name,
					arguments: JSON.stringify({
						action: "create",
						job: {
							name: "stage-11-device-cron-source",
							schedule: { kind: "at", at, timezone: "UTC" },
							payload: {
								kind: "preset",
								preset: "default",
								text: `请求 ${cronProgramMarker}：请使用已授权设备的官方记忆插件，搜索“东京旅行记录”并准确返回行程识别码。`,
							},
							delivery: { to: `acct:card:${bot.id}:${owner.id}`, via: "card" },
							missed: "coalesce",
							maxRuns: 1,
						},
					}),
				};
			}
			if (
				!toolResult &&
				((phase === "online" && lastUser.includes(onlineQueryMarker)) ||
					(phase === "cronRun" && lastUser.includes(cronProgramMarker)))
			) {
				const memory = memoryTool(body);
				if (!memory) return undefined;
				actualMemorySchemaObserved = true;
				return {
					name: memory.function.name,
					arguments: JSON.stringify({ terms: ["东京旅行记录"] }),
				};
			}
			return undefined;
		});
	}
	const first = await turn(owner, bot, onlinePrompt);
	assert.notEqual(first.result.content.type, "error", "online device memory request returned an error");
	if (program) {
		assert.ok(actualMemorySchemaObserved, "loopback transport did not receive the real device memory tool schema");
		assert.ok(
			providerCatalogues.online.some((sample) => sample.some((name) => name.endsWith("_memory_search"))),
			"online provider schema omitted device tools",
		);
		assert.ok(
			toolResultContains(transport.requests(), onlineQueryMarker, marker),
			"online device memory tool result lacked its record",
		);
	} else {
		assert.ok(String(first.result.content.text ?? "").includes(marker), "online device memory value was not returned");
	}
	const deviceState = await deviceSnapshot();
	assert.ok(deviceState.catalogues > 0, "device did not receive a real tool catalogue request");
	assert.ok(
		deviceState.calls.some((call) => ["memory_search", "memory_read"].includes(call.tool) && call.ok),
		"official memory plugin did not execute through a device program ToolTask",
	);
	if (program) {
		transport.mode("reply");
		phase = "cronCreate";
		const created = await turn(
			owner,
			bot,
			`请为请求 ${cronRequestMarker} 建立一次性的定时任务：在十几秒后使用当前已授权设备的官方记忆插件查找东京旅行记录里的行程识别码，随后正常回复。`,
		);
		cronCreateSourceId = created.source.id;
		assert.notEqual(created.result.content.type, "error", "owner DM cron_manage request returned an error");
		const jobsRow = (
			await backend.pool.query(
				"SELECT content FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='cron' AND root='' AND path='jobs.json' AND kind='file'",
				[owner.id, bot.id],
			)
		).rows[0];
		assert.ok(jobsRow?.content, "real cron_manage tool call did not persist jobs.json");
		const jobsText = jobsRow.content;
		const jobs = JSON.parse(jobsText);
		const job = jobs.find((entry) => entry.name === "stage-11-device-cron-source");
		assert.ok(job, "real cron_manage tool call did not persist the scheduled job");
		assert.ok(
			Array.isArray(job.executionOwner?.inputs) && job.executionOwner.inputs.length > 0,
			"cron job has no captured native source event",
		);
		assert.equal(job.resources, undefined, "default cloud context unexpectedly added an explicit resource ceiling");
		phase = "cronRun";
		const sourceArmed = waitMessage(device, (message) => message.type === "source-armed");
		device.send({ type: "expect-source", messageId: created.source.id });
		await sourceArmed;
		const completedRun = await until(async () => {
			const rows = await backend.pool.query(
				"SELECT content FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2 AND plugin_id='cron' AND root='' AND path LIKE 'runs/%.json' AND kind='file'",
				[owner.id, bot.id],
			);
			const runs = rows.rows.map((row) => JSON.parse(row.content));
			const current = runs.find((run) => run.job === job.id);
			return current && current.status !== "running" ? current : undefined;
		}, 90_000);
		assert.equal(
			completedRun.status,
			"done",
			`cron preset failed: ${safeReason(completedRun.error ?? "unknown error")}`,
		);
		assert.ok(completedRun.session, "cron preset did not submit a real session input");
		assert.ok(
			toolResultContains(transport.requests(), cronProgramMarker, marker),
			"cron session did not receive the official device memory result",
		);
		assert.ok(
			providerCatalogues.cronRun.some((sample) => sample.some((name) => name.endsWith("_memory_search"))),
			"cron provider schema omitted device tools",
		);
		const programSnapshot = await until(async () => {
			const state = await deviceSnapshot();
			return state.calls.some((call) => call.ok && call.sourceMatchesExpected) ? state : undefined;
		}, 30_000);
		assert.ok(programSnapshot.catalogues > 0, "cron run did not discover the actual device plugin catalogue");
	}
	assert.equal(
		(
			await backend.pool.query(
				`SELECT count(*)::int AS n FROM messages WHERE conv_id=$1 AND sender_id=$2 AND content->>'type'='error'`,
				[bot.conversation, bot.id],
			)
		).rows[0].n,
		0,
	);
	await writeFile(join(memoryRoot, "mine/offline.md"), `第二条临时记忆识别码为 ${offlineMarker}。\n`);
	await stop(device);
	device = undefined;
	await until(() => !backend.hub.isDeviceConnected(deviceRow.device_id));
	phase = "offline";
	const offline = await turn(
		owner,
		bot,
		"请查找第二条行程记忆中的识别码。如果当前设备或记忆插件已离线，请如实说明，不要复用先前的结果。",
	);
	assert.ok(
		!String(offline.result.content.text ?? "").includes(offlineMarker),
		"offline device memory leaked into the next run",
	);
	assert.equal(worker.connected, true, "cloud worker disconnected during offline-device check");
	const persisted = await backend.pool.query(
		"SELECT row_to_json(t) AS data FROM bot_runtime_commits t WHERE bot_id=$1 ORDER BY seq",
		[bot.id],
	);
	const onlineRunCatalogues = await deviceRunCatalogue(backend.pool, owner.id, bot.id, first.source.id);
	const offlineRunCatalogues = await deviceRunCatalogue(backend.pool, owner.id, bot.id, offline.source.id);
	const onlineRunCatalogue = onlineRunCatalogues.direct;
	const offlineRunCatalogue = offlineRunCatalogues.direct;
	const cronRunCatalogues = cronCreateSourceId
		? await deviceRunCatalogue(backend.pool, owner.id, bot.id, cronCreateSourceId)
		: undefined;
	const cronCreateRunCatalogue = cronRunCatalogues?.direct;
	const cronRunCatalogue = cronRunCatalogues?.inherited;
	console.log(
		JSON.stringify({
			providerRunDocs: {
				online: onlineRunCatalogue,
				...(cronCreateRunCatalogue ? { cronCreate: cronCreateRunCatalogue } : {}),
				...(cronRunCatalogue ? { cronRun: cronRunCatalogue } : {}),
				offline: offlineRunCatalogue,
			},
			...(program
				? {
						loopbackProviderTools: providerCatalogues,
						loopbackRunDocMatch: {
							online: providerCatalogues.online.every(
								(observed) => JSON.stringify(observed) === JSON.stringify(onlineRunCatalogue.tools),
							),
							cronCreate: providerCatalogues.cronCreate.every(
								(observed) => JSON.stringify(observed) === JSON.stringify(cronCreateRunCatalogue?.tools),
							),
							cronRun: providerCatalogues.cronRun.every(
								(observed) => JSON.stringify(observed) === JSON.stringify(cronRunCatalogue?.tools),
							),
							offline: providerCatalogues.offline.every(
								(observed) => JSON.stringify(observed) === JSON.stringify(offlineRunCatalogue.tools),
							),
						},
					}
				: {}),
		}),
	);
	assert.equal(onlineRunCatalogue.matched, true, "online source has no committed Runtime RunDoc catalogue");
	assert.equal(offlineRunCatalogue.matched, true, "offline source has no committed Runtime RunDoc catalogue");
	const onlineProviderTools = onlineRunCatalogue.tools;
	const offlineProviderTools = offlineRunCatalogue.tools;
	assert.ok(onlineProviderTools?.length, "online provider catalogue did not include the frozen device tool schema");
	assert.deepEqual(offlineProviderTools, [], "offline provider catalogue still exposed device tools");
	if (program) {
		assert.ok(providerCatalogues.online.length, "loopback did not sample the online provider schema");
		assert.ok(providerCatalogues.offline.length, "loopback did not sample the offline provider schema");
		for (const observed of providerCatalogues.online)
			assert.deepEqual(observed, onlineProviderTools, "loopback online schema disagreed with committed RunDoc");
		for (const observed of providerCatalogues.offline)
			assert.deepEqual(observed, offlineProviderTools, "loopback offline schema disagreed with committed RunDoc");
		assert.ok(cronCreateRunCatalogue?.matched, "cron-creation source has no committed Runtime RunDoc catalogue");
		assert.ok(cronRunCatalogue?.matched, "cron-run source has no committed Runtime RunDoc catalogue");
		assert.ok(providerCatalogues.cronCreate.length, "loopback did not sample the cron-creation provider schema");
		assert.ok(providerCatalogues.cronRun.length, "loopback did not sample the cron-run provider schema");
		for (const observed of providerCatalogues.cronCreate)
			assert.deepEqual(
				observed,
				cronCreateRunCatalogue.tools,
				"loopback cron-creation schema disagreed with committed RunDoc",
			);
		for (const observed of providerCatalogues.cronRun)
			assert.deepEqual(observed, cronRunCatalogue.tools, "loopback cron-run schema disagreed with committed RunDoc");
	}
	const persistedText = JSON.stringify(persisted.rows);
	assert.equal(persistedText.includes(workerKeyEncoded), false);
	const modelCredential = (await readFile(modelKeyFile, "utf8")).trim();
	assert.ok(modelCredential.length > 0, "model credential file is empty");
	const modelCredentialAbsentFromPersistedCommits = !persistedText.includes(modelCredential);
	const modelCredentialAbsentFromWorkerLogs = [...children].every(
		(child) => !(childLogs.get(child) ?? []).some((line) => line.includes(modelCredential)),
	);
	assert.equal(modelCredentialAbsentFromPersistedCommits, true, "model credential was persisted");
	assert.equal(modelCredentialAbsentFromWorkerLogs, true, "model credential appeared in worker logs");
	console.log(
		JSON.stringify({
			mode: program ? "loopback-tool-transport" : "real-glm-5.3-flash",
			temporaryHome: true,
			independentOfficialMemoryRoot: true,
			realCardLoginAndMapping: true,
			workProtocolBridge: "tools.catalog + tools.call through openKernel/workControl",
			onlineProgramTool: "official memory plugin",
			ownerDmSource: true,
			...(program ? { cronManageOwnerDmSource: true, cronPresetNativeSourceReused: true } : {}),
			offlineNextRunDoesNotReadDeviceMemory: true,
			providerDeviceTools: { online: onlineProviderTools, offline: offlineProviderTools },
			providerRunDocs: { online: onlineRunCatalogue, offline: offlineRunCatalogue },
			workerCredentialAbsentFromPersistedCommits: true,
			modelCredentialAbsentFromPersistedCommits,
			modelCredentialAbsentFromWorkerLogs,
		}),
	);
} catch (error) {
	const reason = safeReason(error instanceof Error ? error.message : "Device verification failed");
	console.error(`Device verification failed: ${reason.slice(0, 300)}`);
	process.exitCode = 1;
} finally {
	for (const child of children) await stop(child).catch(() => child.kill("SIGKILL"));
	try {
		await transport?.close();
		await backend?.close();
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
}
