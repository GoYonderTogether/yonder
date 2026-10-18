import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Models } from "@yonder/sdk";
import type { YonderConfig } from "../config/index.js";
import { FileCredentials } from "./credentials.js";
import { buildModels } from "./models.js";

export type LoginInteraction = Parameters<Models["login"]>[2];

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
): Promise<void> {
	const credentials = new FileCredentials(resolve(home, config.credentials ?? ".yonder/auth.json"));
	const models = buildModels(credentials, config.models?.providers);
	const selected = models.getProvider(provider);
	if (!selected) throw new Error(`Unknown model provider: ${provider}`);
	await loginWithType(models, home, provider, selected.auth.oauth ? "oauth" : "api_key", interaction);
}
