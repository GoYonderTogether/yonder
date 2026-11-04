import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { YonderConfig } from "../config/schema.js";
import type { RuntimeInternals } from "./instance.js";
import type { ModelsJsonProvider } from "./models.js";
import { buildModels } from "./models.js";

export interface CloudModelIssue {
	instance: string;
	code: "not_connected" | "http_error" | "network_error" | "invalid_catalog";
	message: string;
}

/** Only the selected runtime's own Card credential grants access to its owner's cloud catalog. */
export async function refreshCloudModels(
	home: string,
	config: YonderConfig,
): Promise<{
	providers: Record<string, ModelsJsonProvider>;
	apiKeys: Map<string, string>;
	issues: CloudModelIssue[];
}> {
	const providers: Record<string, ModelsJsonProvider> = {};
	const apiKeys = new Map<string, string>();
	const issues: CloudModelIssue[] = [];
	for (const [instance, channel] of Object.entries(config.channels ?? {})) {
		const configured = channel as { type: string; enabled?: boolean; endpoint?: string };
		if (configured.type !== "card" || configured.enabled === false || !/^[\w.-]+$/.test(instance)) continue;
		let code: CloudModelIssue["code"] = "not_connected";
		let message = "尚未连接云端账号，请在名片渠道设置中登录后重试。";
		try {
			const endpoint = new URL(configured.endpoint ?? "https://yonder.zethai.cn").origin;
			const saved = JSON.parse(
				await readFile(join(home, ".yonder", "plugins", "channel-card", `${instance}.json`), "utf8"),
			);
			if (saved.endpoint !== endpoint || typeof saved.token !== "string" || !saved.token)
				throw new Error("Cloud account is not connected");
			code = "network_error";
			message = "云端模型目录连接失败，请检查名片渠道连接与网络后重试；本机模型仍可使用。";
			const response = await fetch(`${endpoint}/api/model-connections/catalog`, {
				headers: { authorization: `Bearer ${saved.token}` },
				signal: AbortSignal.timeout(5000),
				redirect: "error",
			});
			if (!response.ok) {
				code = "http_error";
				message =
					response.status === 401 || response.status === 403
						? "云端模型账号授权失效，请在名片渠道设置中重新登录。"
						: `云端模型目录返回 HTTP ${response.status}，请检查云端服务状态后重试。`;
				throw new Error("Cloud catalog request failed");
			}
			code = "invalid_catalog";
			message = "云端模型目录格式不可用，请更新云端服务后重试。";
			const catalog = (await response.json()) as { providers?: unknown };
			if (!Array.isArray(catalog.providers)) throw new Error("Invalid cloud catalog");
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
			// Report failure without exposing response bodies, URLs containing credentials, or tokens.
			issues.push({ instance, code, message });
		}
	}
	return { providers, apiKeys, issues };
}

export async function refreshRuntimeCloudModels(rt: RuntimeInternals): Promise<void> {
	const next = await refreshCloudModels(rt.options.home, rt.options.config);
	const catalog = buildModels(wrapCloudCredentials(rt.credentials, next.apiKeys), next.providers);
	for (const id of Object.keys(rt.cloud.providers)) rt.models.deleteProvider(id);
	rt.cloud.providers = next.providers;
	rt.cloud.apiKeys = next.apiKeys;
	rt.cloud.issues = next.issues;
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
