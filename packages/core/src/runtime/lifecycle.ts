import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { Harness, LiveDoc, type TaskId } from "@earendil-works/pi-durable";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { ImageProcessor } from "@earendil-works/pi-durable/tools";
import type { ExecutionEnv, Models, ToolContext } from "@yonder/sdk";
import { wrapCloudCredentials } from "./cloud-models.js";
import { cid, ModelBindingDoc, RunDoc, SessionDoc } from "./docs.js";
import { localEnvironment } from "./env.js";
import type { RuntimeInternals } from "./instance.js";
import { fallbackAliases, parseAccountProvider } from "./model-chain.js";
import { accountKey } from "./model-quota.js";
import { buildModels } from "./models.js";
import { Outbox } from "./outbox.js";
import { modelTimeouts, retryPolicy } from "./recovery.js";
import { remoteEnvironment } from "./remote-env.js";
import type { RuntimeOptions } from "./runtime-options.js";
import type { RuntimeSessionConfig } from "./types.js";

export async function openRuntime<T extends RuntimeInternals>(rt: T, options: RuntimeOptions): Promise<T> {
	rt.install();
	const storage = await SqliteStorage.open(options.db, { prefix: "pi_" });
	rt.storage = storage;
	rt.harness = await Harness.open(
		storage,
		{
			models: rt.models,
			resolveModels: async (target, context) => {
				const session = String(target.conversationId);
				const key = String(target.taskId);
				const pinned = await target.read.snapshot(ModelBindingDoc, target.conversationId, key, context);
				if (pinned?.config) return rt.modelsFor(JSON.parse(pinned.config));
				let task = await rt.harness.getTask(target.taskId, context);
				let run: number | undefined;
				const seen = new Set<TaskId>();
				while (task && !seen.has(task.id)) {
					seen.add(task.id);
					const input = task.input as { modelRun?: number };
					if (typeof input.modelRun === "number") {
						run = input.modelRun;
						break;
					}
					if (task.owner === undefined) break;
					task = await rt.harness.getTask(task.owner, context);
				}
				await rt.prepareRun(session, context);
				const saved =
					run === undefined
						? undefined
						: await target.read.snapshot(RunDoc, target.conversationId, String(run), context);
				if (run !== undefined && !saved?.config) throw new Error("Missing frozen run model configuration");
				const config: RuntimeSessionConfig = saved?.config ? JSON.parse(saved.config) : await rt.sessionConfig(session);
				const models = await rt.modelsFor(config);
				await rt.harness.commit(async (tx) => {
					(await tx.doc(ModelBindingDoc, target.conversationId, key, null)).config = JSON.stringify(config);
				}, context);
				return models;
			},
			registry: rt.registry,
			settings: {
				steeringMode: "all",
				followUpMode: "all",
				retry: retryPolicy(options.config.retry),
				...(options.config.compaction ? { compaction: options.config.compaction } : {}),
			},
			beforeAgent: (target, context) => rt.prepareRun(String(target.conversationId), context),
			env: async (target) => {
				const doc = await target.read.snapshot(SessionDoc, target.conversationId, C);
				if (!doc) throw new Error("Missing yonder.session");
				const config =
					rt.currentConfig(String(target.conversationId)) ??
					(await options.resolveSession(String(target.conversationId)));
				return rt.environment(config);
			},
			...(options.onReport ? { onReport: options.onReport } : {}),
		},
		C,
	);
	rt.outbox = new Outbox({
		harness: rt.harness,
		storage,
		sinks: options,
		commit: async (session, change) => {
			await (await rt.conversation(session)).commit(change, C);
		},
	});
	await rt.health.load();
	await rt.quota.load();
	rt.watch.start();
	return rt;
}
export function imageProcessor(rt: RuntimeInternals): Promise<ImageProcessor> {
	rt.images ??= createNodePhotonImages();
	return rt.images;
}
/** A run owns independent provider factories and catalog caches; selection never mutates a global Models. */
export function modelsFor(rt: RuntimeInternals, config: RuntimeSessionConfig): Promise<Models> {
	let pending = rt.boundModels.get(config);
	if (!pending) {
		pending = (async () => {
			const selection = Object.freeze({ ...config.resolved.credentialSlots });
			const aliases = fallbackAliases(config.resolved.fallback, selection, config.resolved.model);
			config.credentialGenerations ??= await rt.credentialSlots.capture(selection, aliases);
			const credentials = wrapCloudCredentials(
				rt.credentialSlots.bind(selection, config.credentialGenerations, aliases),
				new Map(rt.cloud.apiKeys),
			);
			const models = buildModels(
				credentials,
				{ ...rt.options.config.models?.providers, ...rt.cloud.providers },
				selection,
				aliases,
				{
					onProviderEvent: (provider, data) => {
						const alias = parseAccountProvider(provider);
						const account = alias
							? accountKey(alias.provider, alias.slot)
							: accountKey(provider, selection[provider] ?? "default");
						rt.quota.record(account, data);
					},
				},
				modelTimeouts(rt.options.config.timeouts),
			);
			for (const [provider, slot] of Object.entries(selection)) {
				if (!models.getProvider(provider)) throw new Error(`Unknown model provider: ${provider}`);
				if (slot !== "default") await credentials.read(provider);
			}
			for (const alias of Object.keys(aliases)) await credentials.read(alias);
			return models;
		})();
		rt.boundModels.set(config, pending);
	}
	return pending;
}
export function environment(rt: RuntimeInternals, config: RuntimeSessionConfig): ExecutionEnv {
	if (config.resolved.env.startsWith("device:")) return remoteEnvironment(rt, config, config.resolved.env.slice(7));
	if (config.resolved.env === "local") return localEnvironment(config.cwd);
	const env = rt.options.envs?.get(config.resolved.env);
	if (!env) throw new Error(`Unknown execution environment: ${config.resolved.env}`);
	return env;
}
export async function toolContext(rt: RuntimeInternals, id: string, context: Context): Promise<ToolContext> {
	const saved = rt.invocationConfigs.get(context);
	const config = saved?.config ?? rt.currentConfig(id) ?? (await rt.options.resolveSession(id));
	const live = await rt.harness.snapshot(LiveDoc, cid(id), C);
	const events = saved?.events ?? (await rt.sources(live?.run?.inputs ?? []));
	const input = events[0];
	return {
		agent: config.agent,
		profile: config.profile,
		session: id,
		capabilities: [...config.resolved.capabilities],
		...(config.resources ? { resources: structuredClone(config.resources) } : {}),
		...(config.resolved.channelInstances === undefined
			? {}
			: { channelInstances: [...config.resolved.channelInstances] }),
		env: rt.environment(config),
		...(input ? { event: input } : {}),
		events,
		signal: context.abortSignal!,
	};
}
export async function conversationOf(rt: RuntimeInternals, id: string) {
	const value = await rt.harness.conversation(cid(id), C);
	if (!value) throw new Error(`Unknown conversation: ${id}`);
	return value;
}
export function pollQuota(
	rt: RuntimeInternals,
	fallback: RuntimeSessionConfig["resolved"]["fallback"],
	selection: RuntimeSessionConfig["resolved"]["credentialSlots"],
): void {
	const stops = fallback?.quotaStopPercent;
	if (!stops) return;
	const accounts: Array<{ provider: string; slot: string }> = [];
	for (const [provider, slots] of Object.entries(fallback?.accounts ?? {}))
		for (const slot of slots) if (stops[slot] !== undefined) accounts.push({ provider, slot });
	for (const [provider, slot] of Object.entries(selection ?? {}))
		if (stops[slot] !== undefined) accounts.push({ provider, slot });
	rt.quotaPoller.watch(accounts);
	rt.quotaPoller.start();
}
export async function closeRuntime(rt: RuntimeInternals): Promise<void> {
	for (const state of rt.limits.states.values()) {
		state.visibility.abort();
		clearTimeout(state.timer);
	}
	await rt.restartNotes;
	rt.quotaPoller.stop();
	rt.watch.stop();
	await rt.background.close();
	try {
		await rt.harness.close(C);
	} finally {
		for (const state of rt.limits.states.values()) {
			state.visibility.abort();
			clearTimeout(state.timer);
		}
	}
}
