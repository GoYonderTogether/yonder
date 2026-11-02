import type { SessionWorkbenchOptions, YEvent } from "@yonder/sdk";
import { mergeCredentialSlots } from "../config/index.js";
import type { RuntimeSessionConfig, RuntimeSessionState } from "./types.js";

/** Only the owner control API writes this task-session override; channel profiles are unchanged. */
export function applyWorkbenchOptions(
	base: RuntimeSessionConfig,
	options?: SessionWorkbenchOptions,
): RuntimeSessionConfig {
	if (!options) return base;
	const selected = options.resources?.find((resource) => resource.deviceId === "local") ?? options.resources?.[0];
	const cwd = selected
		? (selected.paths[0] ??
			(options.defaultWorkspace?.deviceId === selected.deviceId ? options.defaultWorkspace.path : undefined))
		: undefined;
	return {
		...base,
		...(cwd ? { cwd } : {}),
		...(options.resources ? { resources: structuredClone(options.resources) } : {}),
		resolved: {
			...base.resolved,
			...(selected && cwd ? { env: selected.deviceId === "local" ? "local" : `device:${selected.deviceId}` } : {}),
			...(options.resources?.some((resource) => resource.deviceId !== "local")
				? {
						plugins: [...new Set([...base.resolved.plugins, "devices"])],
						tools: {
							...base.resolved.tools,
							offer: [...new Set([...base.resolved.tools.offer, "devices_list", "devices_operation"])],
						},
					}
				: {}),
			...(options.permission
				? { level: options.permission.level, capabilities: [...options.permission.capabilities] }
				: {}),
		},
	};
}

export function isOwnerWorkbenchInput(event: YEvent | undefined): boolean {
	return (
		event?.type === "message.in" &&
		event.from === "acct:console:owner" &&
		(event.data as { ownerWorkbench?: boolean }).ownerWorkbench === true
	);
}

export function configuredWorkbenchSession(
	resolved: RuntimeSessionConfig,
	id: string,
	state?: RuntimeSessionState,
): RuntimeSessionConfig {
	const base = applyWorkbenchOptions(
		{ ...resolved, sessionId: id },
		resolved.sessionMode === "task" ? state?.workbench : undefined,
	);
	return state?.models
		? {
				...base,
				resolved: {
					...base.resolved,
					...state.models,
					credentialSlots: mergeCredentialSlots(base.resolved.credentialSlots, state.models.credentialSlots),
				},
			}
		: base;
}
