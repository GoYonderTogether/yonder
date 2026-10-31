import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { AgentDoc, LiveDoc } from "@earendil-works/pi-durable";
import type { SessionModels } from "@yonder/sdk";
import { describeCatalog } from "./catalog.js";
import { cid, SessionDoc } from "./docs.js";
import { resolveEffort } from "./effort.js";
import type { RuntimeInternals } from "./instance.js";
import { DEFAULT_FALLBACK_AFTER, modelChain } from "./model-chain.js";
import { chainFallback } from "./model-chain-config.js";
import { defaultLazyGroups, lazyGroupOf } from "./tool-catalog.js";
import type { RuntimeSessionConfig } from "./types.js";

export function describeTools(rt: RuntimeInternals, config: RuntimeSessionConfig) {
	return describeCatalog(
		config,
		[...rt.tools.values()].map((tool) => {
			const extension = [...rt.extensions.values()].find((item) => item.tools?.includes(tool));
			return {
				name: tool.name,
				capabilities: rt.capabilities.get(tool.name) ?? [],
				...(extension?.name.startsWith("plugin:") ? { plugin: extension.name.slice(7) } : {}),
			};
		}),
		rt.activeLazy,
	);
}
/** X7：把懒加载分组提升为常驻工具；tool_search 命中同一分组时也走这里，重新配置后即可直接调用。 */
export async function activateTools(rt: RuntimeInternals, id: string, names: string[]): Promise<string[]> {
	const activated = rt.lazyGroupsOf(id, names);
	for (const group of activated) rt.activeLazy.add(group);
	if (activated.length) await rt.configure(id);
	return activated;
}
/** X7：撤销显式激活，分组内的工具回到 tool_search 命中后才载入。 */
export async function deactivateTools(rt: RuntimeInternals, id: string, names: string[]): Promise<string[]> {
	const deactivated = rt.lazyGroupsOf(id, names);
	for (const group of deactivated) rt.activeLazy.delete(group);
	if (deactivated.length) await rt.configure(id);
	return deactivated;
}
export function lazyGroupsOf(rt: RuntimeInternals, id: string, names: string[]): string[] {
	const groups = rt.configured.get(id)?.resolved.tools.lazyGroups ?? defaultLazyGroups;
	return [...new Set(names.flatMap((name) => lazyGroupOf(name, groups) ?? []))];
}
export async function configure(rt: RuntimeInternals, id: string): Promise<void> {
	if ((await rt.harness.snapshot(LiveDoc, cid(id), C))?.run) return;
	await rt.applyConfiguration(id, await rt.options.resolveSession(id));
}
export async function applyConfiguration(
	rt: RuntimeInternals,
	id: string,
	config: RuntimeSessionConfig,
): Promise<void> {
	const profile = config.resolved;
	const selected = [
		"yonder.core",
		"yonder.files",
		"yonder.tools",
		"yonder.background",
		"yonder.todo",
		"yonder.process",
		...profile.plugins.map((id) => `plugin:${id}`),
	];
	const exposure = rt.describeTools(config);
	const offered = exposure.filter((tool) => tool.exposure === "offer").map((tool) => rt.tools.get(tool.name)!);
	const deferred = exposure.filter((tool) => tool.exposure === "search").map((tool) => rt.tools.get(tool.name)!);
	if (deferred.length) {
		const search = [...rt.extensions.values()].find((extension) =>
			extension.tools?.some((tool) => tool.name === "tool_search"),
		);
		if (search) selected.push(search.name);
	}
	const tools = [...new Set([...offered, ...deferred])];
	const conversation = await rt.conversation(id);
	const fallback = chainFallback(profile, rt.options.config.models);
	rt.pollQuota(fallback, profile.credentialSlots);
	// Held or over-quota entries are not a starting model: they move to the back of the chain.
	const chain = rt.watch.order(
		modelChain(profile.model, fallback, profile.credentialSlots),
		fallback?.quotaStopPercent,
	);
	const primary = chain[0];
	if (!primary) throw new Error("All models are rate limited until reset");
	const model = { provider: primary.provider, modelId: primary.modelId };
	const modelInfo = (await rt.modelsFor(config)).getModel(model.provider, model.modelId);
	const thinking = modelInfo
		? resolveEffort(modelInfo, profile.thinking as ModelThinkingLevel).effective
		: profile.thinking;
	const alternatives = chain.slice(1);
	const modelFallbacks = alternatives.length
		? {
				models: alternatives.map((entry) => ({ provider: entry.provider, modelId: entry.modelId })),
				after: fallback?.after ?? DEFAULT_FALLBACK_AFTER,
			}
		: null;
	const current = await rt.harness.snapshot(AgentDoc, cid(id), C);
	const same =
		current &&
		JSON.stringify(current.model) === JSON.stringify(model) &&
		JSON.stringify(current.modelFallbacks ?? null) === JSON.stringify(modelFallbacks) &&
		current.thinkingLevel === thinking &&
		JSON.stringify(current.extensions) === JSON.stringify(selected) &&
		JSON.stringify(current.tools) === JSON.stringify(tools.map((t) => t.name)) &&
		JSON.stringify(current.modelTools) === JSON.stringify(offered.map((t) => t.name)) &&
		current.instructions === profile.instructions &&
		current.cwd === config.cwd;
	if (!same)
		await conversation.configure(
			{
				model,
				modelFallbacks,
				thinkingLevel: thinking,
				extensions: selected.map((name) => {
					const e = rt.extensions.get(name);
					if (!e) throw new Error(`Unknown runtime extension: ${name}`);
					return e;
				}),
				tools,
				modelTools: offered,
				instructions: profile.instructions,
				cwd: config.cwd,
			},
			C,
		);
	const metadata = await rt.harness.snapshot(SessionDoc, cid(id), C);
	if (metadata?.agent !== config.agent || metadata?.profile !== config.profile)
		await conversation.commit(async (tx) => {
			Object.assign(await tx.doc(SessionDoc, cid(id)), { agent: config.agent, profile: config.profile });
		}, C);
	rt.configured.set(id, config);
}
export async function configureModels(rt: RuntimeInternals, id: string, models: SessionModels | null): Promise<void> {
	await (await rt.conversation(id)).commit(async (tx) => {
		(await tx.doc(SessionDoc, cid(id))).models = models;
	}, C);
	await rt.configure(id);
}
