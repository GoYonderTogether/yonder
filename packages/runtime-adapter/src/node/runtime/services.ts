import { BACKGROUND_CONTEXT as C, withAbortSignal } from "@earendil-works/chord/context";
import { InboxDoc, LiveDoc } from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import type { Models, ServiceEndpoint } from "@yonder/sdk";
import { loginProvider } from "./auth.js";
import type { RuntimeInternals } from "@yonder/runtime-adapter/runtime/instance";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";

export { hasPendingWork, writeNote } from "../../runtime/services.js";

export async function resolveService(rt: RuntimeInternals, capability: string): Promise<ServiceEndpoint | undefined> {
	for (const service of rt.options.config.services ?? []) {
		const selected = service.capabilities[capability];
		if (!selected) continue;
		const credential = service.credential ? await rt.credentials.read(service.credential) : undefined;
		return {
			id: service.id,
			protocol: service.protocol,
			baseUrl: service.baseUrl,
			models: selected.models,
			...(selected.voices ? { voices: selected.voices } : {}),
			...(credential?.type === "api_key" && credential.key ? { apiKey: credential.key } : {}),
		};
	}
}
export async function login(
	rt: RuntimeInternals,
	provider: string,
	type: "api_key" | "oauth",
	interaction: Parameters<Models["login"]>[2],
): Promise<void> {
	await loginProvider(rt.options.home, rt.options.config, provider, interaction, { method: type });
}
export async function executeCommand(
	rt: RuntimeInternals,
	config: RuntimeSessionConfig,
	request: { command: string | string[]; cwd?: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	let stdout = "",
		stderr = "",
		truncated = false;
	const context = request.signal ? withAbortSignal(request.signal, C) : C;
	const result = getOrThrow(
		await rt.environment(config).exec(
			request.command,
			{
				...(request.cwd ? { cwd: request.cwd } : {}),
				spill: { afterBytes: 65536, afterLines: 2000 },
				onOutput(text, _context, info) {
					if (info.stream === "stderr") {
						truncated ||= stderr.length + text.length > 65536;
						stderr = (stderr + text).slice(-65536);
					} else {
						truncated ||= stdout.length + text.length > 65536;
						stdout = (stdout + text).slice(-65536);
					}
				},
			},
			context,
		),
	);
	return {
		stdout: stdout + (truncated ? `\n[Output tail retained; full log: ${result.spillPath ?? "unavailable"}]` : ""),
		stderr,
		exitCode: result.exitCode,
	};
}
