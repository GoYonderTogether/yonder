import type { Models } from "@yonder/sdk";
import { loadYonderConfig } from "../config/index.js";

export async function loginProvider(
	home: string,
	provider: string,
	interaction: Parameters<Models["login"]>[2],
	options: { slot?: string; replace?: boolean; method?: "oauth" | "api_key" } = {},
) {
	const { loginProvider: login } = await import("../runtime/index.js");
	await login(home, await loadYonderConfig(home), provider, interaction, options);
}
export type LoginInteraction = Parameters<Models["login"]>[2];
/** Store a new non-model named API key without opening the kernel database. */
export async function setNamedCredential(home: string, name: string, key: string, signal?: AbortSignal): Promise<void> {
	const { credentialPath, storeNamedCredential } = await import("../runtime/credentials.js");
	const config = await loadYonderConfig(home);
	await storeNamedCredential(credentialPath(home, config.credentials), name, key, signal);
}
/** Local operator slot management; returns metadata only and never opens the runtime database. */
export async function manageCredentialSlots(
	home: string,
	action: "list" | "status" | "create" | "remove",
	provider?: string,
	slot?: string,
	variable?: string,
) {
	const { CredentialSlotStore } = await import("../runtime/credential-slots.js");
	const { credentialPath } = await import("../runtime/credentials.js");
	const config = await loadYonderConfig(home);
	const slots = new CredentialSlotStore(credentialPath(home, config.credentials));
	if (action === "list") {
		const { buildModels } = await import("../runtime/models.js");
		const models = buildModels(slots.defaults, config.models?.providers);
		const entries = await slots.list();
		for (const entry of await slots.defaults.list()) {
			if (
				models.getProvider(entry.providerId) &&
				!entries.some((item) => item.provider === entry.providerId && item.slot === "default")
			)
				entries.push({
					provider: entry.providerId,
					slot: "default",
					configured: true,
					type: entry.type,
					sourceKind: "stored",
				});
		}
		return entries;
	}
	if (!provider || !slot) throw new Error("Provider and slot are required");
	const { buildModels } = await import("../runtime/models.js");
	const selected = buildModels(slots.defaults, config.models?.providers).getProvider(provider);
	if (!selected) throw new Error(`Unknown model provider: ${provider}`);
	if (action === "create")
		await slots.create(provider, slot, variable ? { kind: "env-ref", variable } : { kind: "stored" });
	if (action === "remove") {
		await slots.remove(provider, slot);
		return { provider, slot, removed: true };
	}
	return {
		...(await slots.status(provider, slot)),
		authentication: {
			oauth: !!selected.auth.oauth,
			apiKey: !!selected.auth.apiKey,
			interactiveApiKey: !!selected.auth.apiKey?.login,
		},
	};
}
