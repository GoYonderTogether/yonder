import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { Runtime } from "./index.js";

/** Public model metadata only; provider URL, headers, credentials and OAuth data never leave the Runtime. */
export async function modelCatalog(runtime: Runtime, configured: string[] = []) {
	const available = new Set((await runtime.models.getAvailable()).map((model) => `${model.provider}/${model.id}`));
	return runtime.models
		.getProviders()
		.filter(
			(provider) =>
				configured.includes(provider.id) ||
				Object.hasOwn(runtime.cloud.providers, provider.id) ||
				provider.getModels().some((model) => available.has(`${provider.id}/${model.id}`)),
		)
		.map((provider) => ({
			id: provider.id,
			name: provider.name ?? provider.id,
			models: provider.getModels().map((model) => ({
				id: model.id,
				provider: provider.id,
				name: model.name,
				available: Object.hasOwn(runtime.cloud.providers, provider.id) || available.has(`${provider.id}/${model.id}`),
				...(Object.hasOwn(runtime.cloud.providers, provider.id) || available.has(`${provider.id}/${model.id}`)
					? {}
					: { reason: "当前运行宿主未配置该供应商凭据" }),
				source: Object.hasOwn(runtime.cloud.providers, provider.id) ? ("cloud" as const) : ("runtime" as const),
				reasoning: model.reasoning,
				effortLevels: getSupportedThinkingLevels(model),
				input: model.input,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
			})),
		}));
}
