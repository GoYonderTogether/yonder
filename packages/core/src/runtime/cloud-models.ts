import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { YonderConfig } from "../config/schema.js";
import type { RuntimeInternals } from "./instance.js";
import type { ModelsJsonProvider } from "./models.js";
import { buildModels } from "./models.js";

/** Only the selected runtime's own Card credential grants access to its owner's cloud catalog. */
export async function refreshCloudModels(
	home: string,
	config: YonderConfig,
): Promise<{
	providers: Record<string, ModelsJsonProvider>;
	apiKeys: Map<string, string>;
}> {
	const providers: Record<string, ModelsJsonProvider> = {};
	const apiKeys = new Map<string, string>();
	for (const [instance, channel] of Object.entries(config.channels ?? {})) {
		const configured = channel as { type: string; enabled?: boolean; endpoint?: string };
		if (configured.type !== "card" || configured.enabled === false || !/^[\w.-]+$/.test(instance)) continue;
		try {
			const endpoint = new URL(configured.endpoint ?? "https://yonderbot.net").origin;
			const saved = JSON.parse(
				await readFile(join(home, ".yonder", "plugins", "channel-card", `${instance}.json`), "utf8"),
			);
			if (saved.endpoint !== endpoint || typeof saved.token !== "string" || !saved.token) continue;
			const response = await fetch(`${endpoint}/api/model-connections/catalog`, {
				headers: { authorization: `Bearer ${saved.token}` },
				signal: AbortSignal.timeout(5000),
				redirect: "error",
			});
			if (!response.ok) continue;
			const catalog = (await response.json()) as { providers?: unknown };
			if (!Array.isArray(catalog.providers)) continue;
			for (const item of catalog.providers) {
				if (
					!item ||
					typeof item !== "object" ||
					typeof item.id !== "string" ||
					!/^cloud-[0-9a-f-]{36}$/.test(item.id) ||
					item.source !== "cloud" ||
					!Array.isArray(item.models) ||
					!["openai-completions", "openai-responses", "anthropic-messages"].includes(item.api)
				)
					continue;
				// A catalog cannot direct our device credential to a different endpoint.
				const baseUrl = `${endpoint}/api/model-connections/${item.id.slice(6)}/proxy`;
				if (item.baseUrl !== baseUrl) continue;
				providers[item.id] = {
					name: typeof item.provider === "string" ? `${item.name} · ${item.provider}` : item.name,
					api: item.api,
					baseUrl,
					authHeader: true,
					models: item.models,
				};
				apiKeys.set(item.id, saved.token);
			}
		} catch {
			// An unavailable cloud must not prevent local models from loading. Missing cloud models remain unavailable.
		}
	}
	return { providers, apiKeys };
}

export async function refreshRuntimeCloudModels(rt: RuntimeInternals): Promise<void> {
	const next = await refreshCloudModels(rt.options.home, rt.options.config);
	const catalog = buildModels(wrapCloudCredentials(rt.credentials, next.apiKeys), next.providers);
	for (const id of Object.keys(rt.cloud.providers)) rt.models.deleteProvider(id);
	rt.cloud.providers = next.providers;
	rt.cloud.apiKeys = next.apiKeys;
	for (const id of Object.keys(next.providers)) {
		const provider = catalog.getProvider(id);
		if (provider) rt.models.setProvider(provider);
	}
}

/** Cloud bearer credentials stay in memory and never enter auth.json or a run snapshot. */
export function wrapCloudCredentials(base: CredentialStore, apiKeys: ReadonlyMap<string, string>): CredentialStore {
	return {
		read: (name, options) =>
			apiKeys.has(name)
				? Promise.resolve({ type: "api_key" as const, key: apiKeys.get(name)! })
				: base.read(name, options),
		list: async (options) => [
			...(await base.list(options)).filter((item) => !apiKeys.has(item.providerId)),
			...Array.from(apiKeys.keys(), (providerId) => ({ providerId, type: "api_key" as const })),
		],
		modify: (name, fn, options) => {
			if (apiKeys.has(name)) throw new Error("Manage cloud model credentials in cloud settings");
			return base.modify(name, fn, options);
		},
		delete: (name, options) => {
			if (apiKeys.has(name)) throw new Error("Manage cloud model credentials in cloud settings");
			return base.delete(name, options);
		},
	};
}
