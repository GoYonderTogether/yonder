import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import type { Models } from "@yonder/sdk";
import type { YonderConfig } from "../config/index.js";
import { CredentialSlotStore } from "./credential-slots.js";
import { credentialPath } from "./credentials.js";
import { buildModels } from "./models.js";

export type LoginInteraction = Parameters<Models["login"]>[2];
export interface ProviderLoginOptions {
	slot?: string;
	replace?: boolean;
	method?: "oauth" | "api_key";
}

export async function loginWithType(
	models: Models,
	home: string,
	provider: string,
	type: "oauth" | "api_key",
	interaction: LoginInteraction,
): Promise<void> {
	await models.login(provider, type, interaction, {
		agentName: "Yonder Harness",
		getDeviceId: () => {
			const file = resolve(home, ".yonder/device-id");
			if (existsSync(file)) return readFileSync(file, "utf8").trim();
			mkdirSync(dirname(file), { recursive: true });
			const id = randomUUID();
			writeFileSync(file, id, { mode: 0o600 });
			return id;
		},
	});
}

export async function loginProvider(
	home: string,
	config: YonderConfig,
	provider: string,
	interaction: LoginInteraction,
	options: ProviderLoginOptions = {},
): Promise<void> {
	const slots = new CredentialSlotStore(credentialPath(home, config.credentials));
	const slot = options.slot ?? "default";
	const catalog = buildModels(slots.defaults, config.models?.providers);
	const selected = catalog.getProvider(provider);
	if (!selected) throw new Error(`Unknown model provider: ${provider}`);
	const type = options.method ?? (selected.auth.oauth ? "oauth" : "api_key");
	if (type === "oauth" ? !selected.auth.oauth : !selected.auth.apiKey?.login)
		throw new Error(`Provider ${provider} does not support interactive ${type} login`);
	const ticket = await slots.beginLogin(
		provider,
		slot,
		options.replace,
		interaction.signal ? { signal: interaction.signal } : undefined,
	);
	const bound = slots.bind({ [provider]: slot });
	// Provider-owned network flow runs outside all storage locks; only successful results enter CAS commit.
	const credentials: CredentialStore = {
		read: bound.read,
		list: bound.list,
		delete: bound.delete,
		modify: async (name, fn, operation) => {
			if (name !== provider) throw new Error("Unexpected login provider");
			operation?.signal?.throwIfAborted();
			const credential = await fn(undefined);
			if (!credential) throw new Error("Provider returned no credential");
			interaction.signal?.throwIfAborted();
			await slots.commitLogin(ticket, credential, interaction.signal ? { signal: interaction.signal } : undefined);
			return credential;
		},
	};
	await loginWithType(buildModels(credentials, config.models?.providers), home, provider, type, interaction);
}
