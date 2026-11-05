import { readFile, stat } from "node:fs/promises";
import { redactError } from "@yonder/bot-core/delivery/model-notice";
import { createCardWorkerPlugin } from "@yonder/plugin-channel-card";
import {
	createPostgresRuntimeServices,
	migratePostgresRuntime,
	PLATFORM_BASE_URL,
	PLATFORM_MODEL,
	parsePlatformModel,
} from "@yonder/runtime-adapter/postgres";
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
	/**
	 * Platform model endpoint and id (env `CLOUD_BOT_MODEL_BASE_URL` / `CLOUD_BOT_MODEL`, both optional).
	 * They only ever widen a deployment's own configuration, never a user's choice: every cloud Bot keeps using
	 * the one platform model, and `PLATFORM_MODEL_REF` is what a new Bot's config is seeded with.
	 */
	modelBaseUrl?: string;
	model?: string;
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
	// CLOUD_BOT_MODEL may be a bare model id (legacy DeepSeek) or `provider/model` from the installed catalog.
	const modelRef = options.model ?? PLATFORM_MODEL;
	const { provider: modelProvider, model: modelId } = parsePlatformModel(modelRef);
	const runtimeHost = await createPostgresRuntimeServices({
		pool,
		apiKey,
		baseUrl: options.modelBaseUrl ?? PLATFORM_BASE_URL,
		model: modelRef,
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
		greeted(botIds) {
			// 平台只在收到这一帧后消费待提醒事实；连接在事件处理前断掉时它会留着，下次再提醒。
			void fetch(`${options.endpoint}/api/worker/greeted`, {
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				body: JSON.stringify({ botIds }),
			}).catch((error) => report(error));
		},
		async onBots(bots: CloudBotIdentity[]) {
			await disconnection;
			if (closed) return;
			connectionActive = true;
			identities.clear();
			for (const bot of bots) identities.set(bot.id, bot);
			connected();
			await scheduler.start();
			// 平台只说「你已连上主人和这个真实私聊」，打不打招呼由 Bot 自己决定；模型失败走普通运行错误。
			// 只有真的唤醒了 Bot 才回报，平台据此消费那条待提醒事实。
			const greeted: string[] = [];
			for (const bot of bots) if (bot.greetConv && (await greet(bot))) greeted.push(bot.id);
			if (greeted.length) card.acknowledgeGreetings(greeted);
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
	/**
	 * 把「已连上主人」变成一条真实的 channel.connected 事件，与设备侧 ownerConnected 同一条内核路径：
	 * 它按 Bot 自己的主人私聊绑定唤醒 main，由模型决定说什么。平台不写问候文案，也不代发消息。
	 */
	async function greet(bot: CloudBotIdentity & { greetConv?: string }): Promise<boolean> {
		const conv = bot.greetConv;
		if (!conv) return false;
		return enqueue(bot.id, async ({ bot: instance }) => {
			const event = await instance.router.emit({
				type: "channel.connected",
				from: "plugin:channel-card",
				conv: `conv:card:${bot.id}:${conv}`,
				data: {
					account: `acct:card:${bot.id}:${bot.ownerId}`,
					kind: "dm",
					target: bot.id,
					text: `渠道 card 已连接主人 ${bot.ownerId}，私聊是 ${conv}。你可以向主人打个招呼。`,
				},
			});
			// 没有路由唤醒就什么都没发生：不回报，下次连上会再提醒，并在日志里可见而不是静默。
			const woken = !!event.routes?.some((route) => route.agent === bot.id && route.wake === "run" && !route.dropped);
			if (!woken) report(new Error(`Cloud Bot ${bot.id} could not be woken for its connection notice`));
			return woken;
		}).then((value) => value === true);
	}
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
				model: `${modelProvider}/${modelId}`,
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
						// 额度拒绝把服务端给出的真实原因（哪项上限、何时重置）原样带到这一轮的停止原因里，
						// 渠道侧显示的必须是这句，而不是一条笼统的「准入失败」。
						if (body.error === "quota_exceeded") throw new Error(body.message ?? "模型额度已用完");
						throw new Error(
							response.status === 429
								? "已达到云端 Bot 每小时回复上限"
								: body.error === "rate_limit_unavailable"
									? `云端额度服务暂不可用（HTTP ${response.status}）`
									: `云端额度准入失败（HTTP ${response.status}）：${body.message ?? body.error ?? "请求未获准"}`,
						);
					}
				},
				// Token 额度按每一次模型调用检查与入账：准入只管运行开始，长运行可能在半途撞上额度。
				async checkQuota(run) {
					// 每次模型调用前重判额度；只读服务端账本，不再占用每小时回复名额。
					try {
						const response = await fetch(`${options.endpoint}/api/worker/bots/${encodeURIComponent(id)}/quota-check`, {
							method: "POST",
							headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
							body: JSON.stringify({ runId: run }),
						});
						if (response.ok || response.status === 204) return undefined;
						const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
						if (body.error === "quota_exceeded") return body.message ?? "模型额度已用完";
						return `云端额度服务暂不可用（HTTP ${response.status}）`;
					} catch {
						return "云端额度服务暂不可用";
					}
				},
				async recordQuota(run, usage) {
					// 入账失败只报告，不让一次已经完成的模型调用变成失败：下一次检查仍会按服务端账本判定。
					try {
						const response = await fetch(`${options.endpoint}/api/worker/bots/${encodeURIComponent(id)}/model-usage`, {
							method: "POST",
							headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
							body: JSON.stringify({ runId: run, input: usage.input, output: usage.output }),
						});
						if (!response.ok) report(new Error(`Cloud model usage report failed (HTTP ${response.status})`));
					} catch {
						report(new Error("Cloud model usage report failed"));
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
