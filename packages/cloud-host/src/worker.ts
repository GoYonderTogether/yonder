import { readFile, stat } from "node:fs/promises";
import { redactError } from "@yonder/bot-core/delivery/model-notice";
import { createCardWorkerPlugin } from "@yonder/plugin-channel-card";
import { createPostgresRuntimeServices, migratePostgresRuntime } from "@yonder/runtime-adapter/postgres";
import type { Delivery, EventInput } from "@yonder/sdk";
import type { Pool } from "pg";
import type { CloudBotIdentity } from "./definitions.js";
import { openCloudBot } from "./open-bot.js";
import { migratePluginStorage } from "./plugin-storage.js";
import { cloudPluginDescriptors } from "./plugins.js";
import { createPostgresScheduler, migrateScheduler } from "./scheduler.js";
import { migrateDefinitions } from "./schema.js";
import { migratePostgresStore } from "./store/postgres.js";

export const CLOUD_BOT_IDLE_MS = 60_000;

async function privateFile(path: string) {
	if ((await stat(path)).mode & 0o077) throw new Error("Worker key file must have private permissions");
	return readFile(path);
}

export interface CloudWorkerOptions {
	pool: Pool;
	endpoint: string;
	workerKeyFile: string;
	modelKeyFile: string;
	/** Transport test seam; the executable always uses the platform endpoint/model. */
	modelBaseUrl?: string;
	report?(error: unknown): void;
}

export async function migrateCloudWorker(pool: Pool) {
	await migrateDefinitions(pool);
	await migratePluginStorage(pool);
	await migratePostgresStore(pool);
	await migratePostgresRuntime(pool);
	await migrateScheduler(pool);
}

/** A single channel, Pool and scheduler serve every Bot; queues hold source leases, never a second Bot loop. */
export async function startCloudWorker(options: CloudWorkerOptions) {
	const { pool } = options;
	const report =
		options.report ??
		((error: unknown) => console.error(redactError(error instanceof Error ? error.message : String(error))));
	const rawWorkerKey = await privateFile(options.workerKeyFile);
	if (rawWorkerKey.byteLength !== 32) throw new Error("Worker service key must contain 32 raw bytes");
	const token = rawWorkerKey.toString("base64url");
	const apiKey = (await privateFile(options.modelKeyFile)).toString("utf8").trim();
	if (!apiKey) throw new Error("Model key file is empty");
	await migrateCloudWorker(pool);
	const environment = await readFile(new URL("../prompts/environment.md", import.meta.url), "utf8");
	const version = (
		JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
	).version;
	const runtimeHost = await createPostgresRuntimeServices({
		pool,
		apiKey,
		...(options.modelBaseUrl ? { baseUrl: options.modelBaseUrl } : {}),
		onReport: report,
	});
	type Bot = Awaited<ReturnType<typeof openCloudBot>>;
	type Entry = { ready: Promise<Bot>; busy: boolean; used: number; closing?: Promise<void> };
	const identities = new Map<string, CloudBotIdentity>();
	const active = new Map<string, Entry>();
	const queues = new Map<string, Promise<unknown>>();
	const sources = new Map<
		string,
		{ resolve(delivery: Delivery): void; done: Promise<Delivery>; controller: AbortController }
	>();
	const available = new Set<() => void>();
	let closed = false;
	let connectionActive = false;
	let disconnection = Promise.resolve();
	let highWater = 0;
	let completed = 0;
	let connected!: () => void;
	const ready = new Promise<void>((resolve) => {
		connected = resolve;
	});
	const release = () => {
		for (const resolve of available) resolve();
		available.clear();
	};
	function disconnect(reason: string): Promise<void> {
		if (!connectionActive) return disconnection;
		connectionActive = false;
		for (const source of sources.values()) {
			source.controller.abort();
			source.resolve({ ok: false, uncertain: true, error: reason });
		}
		release();
		disconnection = Promise.all(
			[...active.values()].map(async (entry) => {
				if (entry.closing) return entry.closing;
				const bot = await entry.ready;
				for (const session of await bot.store.sessions.list({ open: true })) await bot.runtime.abort(session.id);
			}),
		).then(() => {});
		return disconnection;
	}
	const scheduler = createPostgresScheduler(
		pool,
		async (tenant, bot, key, now) => {
			if (identities.get(bot)?.ownerId !== tenant) return;
			await enqueue(bot, async (instance) => instance.scheduler.run(key, now));
		},
		report,
		Date.now(),
		{
			changed: release,
			enabled: (tenant, bot) => identities.get(bot)?.ownerId === tenant,
			async maintenance(now) {
				const services = runtimeHost.forBot("worker", "worker");
				await services.watch.tick(now);
				await releaseIdle(now);
			},
		},
	);
	const card = createCardWorkerPlugin({
		endpoint: options.endpoint,
		token,
		log: (message: string) => report(new Error(message)),
		async onBots(bots: CloudBotIdentity[]) {
			await disconnection;
			if (closed) return;
			connectionActive = true;
			identities.clear();
			for (const bot of bots) identities.set(bot.id, bot);
			connected();
			await scheduler.start();
		},
		async onResult(sourceMessageId: string, delivery: Delivery) {
			sources.get(sourceMessageId)?.resolve(delivery);
		},
		disconnected: disconnect,
		async receive(input: { agentId: string; convId: string; sourceMessageId: string; event: EventInput }) {
			let resolve!: (delivery: Delivery) => void;
			const done = new Promise<Delivery>((finish) => {
				resolve = finish;
			});
			const controller = new AbortController();
			sources.set(input.sourceMessageId, { resolve, done, controller });
			try {
				await enqueue(
					input.agentId,
					async ({ bot }) => {
						const event = await bot.router.emit(input.event);
						if (!event.routes?.some((route) => route.agent === input.agentId && route.wake === "run" && !route.dropped))
							await card.channels.get("card")!.send(`conv:card:${input.agentId}:${input.convId}`, {
								text: "云端 Bot 没有可接收此消息的路由",
								sourceMessageId: input.sourceMessageId,
								content: { type: "error", text: "云端 Bot 没有可接收此消息的路由" },
							});
						await done;
						completed++;
					},
					controller.signal,
				);
			} catch (error) {
				if (closed || controller.signal.aborted) return;
				const text = `云端 Bot 启动或路由失败：${redactError(error instanceof Error ? error.message : String(error)).slice(0, 300)}`;
				await card.channels.get("card")!.send(`conv:card:${input.agentId}:${input.convId}`, {
					text,
					content: { type: "error", text },
					sourceMessageId: input.sourceMessageId,
				});
			} finally {
				sources.delete(input.sourceMessageId);
			}
		},
	});
	const descriptors = await cloudPluginDescriptors(card.plugin);
	function retire(id: string, entry: Entry, bot: Bot) {
		entry.closing = bot.close().finally(() => {
			active.delete(id);
			release();
		});
		return entry.closing;
	}
	async function releaseIdle(now: number) {
		for (const [id, entry] of active) {
			if (entry.busy || entry.closing || now - entry.used < CLOUD_BOT_IDLE_MS) continue;
			const bot = await entry.ready;
			if (await bot.busy()) continue;
			// A message may have acquired this Bot while its native state was being read.
			if (!entry.busy && !entry.closing && now - entry.used >= CLOUD_BOT_IDLE_MS) await retire(id, entry, bot);
		}
	}
	async function acquire(id: string, signal?: AbortSignal): Promise<Entry> {
		for (;;) {
			signal?.throwIfAborted();
			if (closed) throw new Error("Cloud worker stopped");
			const previous = active.get(id);
			if (previous?.closing) {
				await previous.closing;
				continue;
			}
			if (previous) {
				previous.busy = true;
				return previous;
			}
			if (active.size < 20) break;
			let retired = false;
			for (const [candidateId, entry] of [...active.entries()].sort((a, b) => a[1].used - b[1].used)) {
				if (entry.busy || entry.closing) continue;
				const bot = await entry.ready;
				if (await bot.busy()) continue;
				if (entry.busy || entry.closing) continue;
				await retire(candidateId, entry, bot);
				retired = true;
				break;
			}
			if (!retired) await new Promise<void>((resolve) => available.add(resolve));
		}
		const identity = identities.get(id);
		if (!identity) throw new Error("Cloud Bot is unavailable or paused");
		const scoped = scheduler.scope(identity.ownerId, id);
		const entry: Entry = {
			busy: true,
			used: Date.now(),
			ready: openCloudBot({
				pool,
				deviceBridge: { endpoint: options.endpoint, token },
				identity,
				descriptors,
				channels: card.channels,
				scheduler: scoped,
				onIdle() {
					const entry = active.get(id);
					if (entry) entry.used = Date.now();
					release();
				},
				runtimeServices: runtimeHost.forBot(identity.ownerId, id),
				environment,
				version,
				report,
				async admitRun({ run, inputs }) {
					const source = inputs.find(
						(event) => event.type === "message.in" && (event.data as { msgId?: string }).msgId,
					);
					const sourceMessageId = source && (source.data as { msgId: string }).msgId;
					const response = await fetch(
						`${options.endpoint}/api/worker/bots/${encodeURIComponent(id)}/model-admission`,
						{
							method: "POST",
							headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
							body: JSON.stringify({ runId: run, ...(sourceMessageId ? { sourceMessageId } : {}) }),
						},
					);
					if (!response.ok) {
						const body = (await response.json()) as { error?: string; message?: string };
						throw new Error(
							response.status === 429
								? "已达到云端 Bot 每小时回复上限"
								: body.error === "rate_limit_unavailable"
									? `云端额度服务暂不可用（HTTP ${response.status}）`
									: `云端额度准入失败（HTTP ${response.status}）：${body.message ?? body.error ?? "请求未获准"}`,
						);
					}
				},
			}),
		};
		active.set(id, entry);
		highWater = Math.max(highWater, active.size);
		return entry;
	}
	function enqueue<T>(
		id: string,
		operation: (instance: { bot: Bot; scheduler: ReturnType<typeof scheduler.scope> }) => Promise<T>,
		signal?: AbortSignal,
	): Promise<T | undefined> {
		const previous = queues.get(id) ?? Promise.resolve();
		const task = previous
			.catch(() => {})
			.then(async () => {
				if (signal?.aborted) return;
				const entry = await acquire(id, signal);
				let bot: Bot | undefined;
				try {
					bot = await entry.ready;
					if (signal?.aborted) return;
					return await operation({ bot, scheduler: bot.scheduler });
				} finally {
					if (!bot) active.delete(id);
					entry.busy = false;
					// Only source-message leases carry a signal; idle plugin scans must not renew the Bot.
					if (signal) entry.used = Date.now();
					release();
				}
			});
		queues.set(id, task);
		const settled = () => {
			if (queues.get(id) === task) queues.delete(id);
		};
		void task.then(settled, settled);
		return task;
	}
	await card.start();
	await ready;
	return {
		state: () => ({
			active: active.size,
			highWater,
			activeIds: [...active.keys()],
			databaseConnections: pool.totalCount,
			// Queue leases only. LRU also checks Runtime and Trigger busy state before eviction.
			busy: [...active.values()].filter((entry) => entry.busy).length,
			completed,
			pendingSources: sources.size,
			rss: process.memoryUsage().rss,
		}),
		async close() {
			closed = true;
			release();
			const stoppedScheduling = scheduler.stop();
			await disconnect("Cloud worker stopped");
			await card.stop();
			for (const entry of active.values()) await (entry.closing ?? entry.ready.then((bot) => bot.close()));
			await Promise.allSettled([...queues.values()]);
			await stoppedScheduling;
			active.clear();
			await runtimeHost.close();
		},
	};
}
