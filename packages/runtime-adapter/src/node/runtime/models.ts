import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
	buildModels as buildSharedModels,
	type ModelHost,
	type ModelsTelemetry,
	type ModelTimeouts,
} from "../../runtime/models.js";
import { enableProviderTrace, traceCredentials, traceModel } from "./provider-trace.js";

export * from "../../runtime/models.js";

export function buildModels(
	credentials: CredentialStore,
	configs: Record<string, unknown> = {},
	credentialSlots: Readonly<Record<string, string>> = {},
	aliases: Readonly<Record<string, { provider: string; slot: string }>> = {},
	telemetry?: ModelsTelemetry,
	timeouts: ModelTimeouts = {},
) {
	const trace = enableProviderTrace();
	const host: ModelHost = {
		providers: builtinProviders(),
		env: async (name) => process.env[name],
		fileExists: async (path) => {
			try {
				await access(path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path);
				return true;
			} catch {
				return false;
			}
		},
		...(trace ? { traceModel } : {}),
	};
	return buildSharedModels(
		trace ? traceCredentials(credentials) : credentials,
		configs,
		credentialSlots,
		aliases,
		telemetry,
		timeouts,
		host,
	);
}
