import { securityOf, type YonderConfig } from "@yonder/local-host/config/index";
import { createWorkspaces } from "@yonder/local-host/kernel/workspaces";
import type { Runtime } from "@yonder/runtime-adapter/node";
import { modelCatalog } from "@yonder/runtime-adapter/runtime/model-catalog.js";
import type { Preset, SessionOptions, SessionsAPI, Tool } from "@yonder/sdk";

export function createWorkbenchOptions(
	home: string,
	config: YonderConfig,
	runtime: () => Runtime,
	sessions: SessionsAPI,
	presets: () => Preset[],
	tools: Map<string, Tool[]>,
) {
	const workspaces = createWorkspaces(home, config, tools);
	const permissions = () => [
		...["bypass", "standard", "readonly"].map((id) => ({
			id,
			name: id,
			...securityOf({ level: id as "bypass" | "standard" | "readonly" }),
		})),
		...presets()
			.filter((preset) => preset.level || preset.capabilities)
			.map((preset) => ({ id: preset.id, name: preset.description || preset.id, ...pickSecurity(preset) })),
	];
	function pickSecurity(preset: Preset) {
		const { level, capabilities } = securityOf(preset);
		return { ...(level ? { level } : {}), capabilities };
	}
	async function get(id: string) {
		const state = await runtime().sessionState(id);
		if (!state) throw new Error(`Unknown session: ${id}`);
		const current = await runtime().sessionConfig(id),
			selected = state.models;
		return {
			model: selected?.model ?? current.resolved.model,
			effort: selected?.thinking ?? current.resolved.thinking,
			permission: state.workbench?.permission?.id ?? current.resolved.level ?? "custom",
			resources: state.workbench?.resources ?? [],
			capabilities: state.workbench?.permission?.capabilities ?? current.resolved.capabilities,
			running: await runtime().hasPendingWork(id),
			permissions: permissions(),
		};
	}
	async function validate(
		options: SessionOptions,
		signal: AbortSignal,
		scope?: import("@yonder/runtime-adapter/types").RuntimeSessionConfig,
	) {
		if (options.model) {
			if (options.model.startsWith("cloud-")) await runtime().refreshModels();
			const slash = options.model.indexOf("/");
			if (slash < 1 || !runtime().models.getModel(options.model.slice(0, slash), options.model.slice(slash + 1)))
				throw new Error("Unknown model");
		}
		const remote = options.resources?.some((resource) => resource.deviceId !== "local") === true;
		if (remote) {
			const issue = deviceIssue();
			if (issue) throw new Error(issue);
		}
		let permission =
			options.permission === undefined ? undefined : permissions().find((entry) => entry.id === options.permission);
		if (options.permission !== undefined && !permission) throw new Error("Unknown permission preset");
		if (permission && scope)
			permission = {
				...permission,
				capabilities: permission.capabilities.filter((capability) => scope.resolved.capabilities.includes(capability)),
			};
		return {
			permission,
			resources:
				options.resources === undefined
					? undefined
					: await workspaces.validate(
							options.resources.length ? options.resources : (scope?.resources ?? []),
							signal,
							scope,
						),
		};
	}
	async function set(id: string, options: SessionOptions, signal: AbortSignal) {
		const session = await sessions.get(id);
		if (!session || session.closed) throw new Error("Session is not open");
		if (options.resources !== undefined && (await runtime().hasPendingWork(id)))
			throw new Error("Finish or cancel pending work before changing resources");
		const scope = session.parent ? await runtime().sessionConfig(session.parent) : undefined;
		const { permission, resources } = await validate(options, signal, scope);
		const selected = resources?.find((resource) => resource.deviceId === "local") ?? resources?.[0];
		const defaultPath = selected
			? (selected.paths[0] ??
				(await workspaces.devices(signal, scope)).find((device) => device.deviceId === selected.deviceId)?.paths[0])
			: undefined;
		const state = await runtime().sessionState(id);
		if (!state) throw new Error("Session state unavailable");
		const models = { ...state.models, ...(options.model ? { model: options.model, fallback: { models: [] } } : {}) };
		if (options.effort === "auto") delete models.thinking;
		else if (options.effort !== undefined) models.thinking = options.effort;
		state.models = models;
		state.workbench = {
			...state.workbench,
			...(permission
				? {
						permission: {
							id: permission.id,
							...(permission.level ? { level: permission.level } : {}),
							capabilities: permission.capabilities,
						},
					}
				: {}),
			...(resources
				? {
						resources,
						...(selected && defaultPath
							? { defaultWorkspace: { deviceId: selected.deviceId, path: defaultPath } }
							: {}),
					}
				: {}),
		};
		await runtime().setSessionState(id, state);
		await runtime().configureModels(id, models);
		return get(id);
	}
	/**
	 * A remote resource needs the devices plugin to be *loaded*, not merely added to the resolved
	 * plugin list (19 §7: no auto-install, no silent expansion of the device set). Report the real
	 * reason instead of letting `devices_*` tools quietly disappear.
	 */
	function deviceIssue(): string | undefined {
		if (!config.plugins?.some((plugin) => plugin.use === "@yonder/plugin-devices")) {
			return "Remote resources need the devices plugin; add it with `yonder plugins add @yonder/plugin-devices`";
		}
		// A loaded plugin contributes its tool set to this map; an empty set still means it loaded.
		if (tools.has("devices")) return undefined;
		return "The devices plugin is configured but did not load; check the harness log for the plugin error";
	}
	return {
		get,
		set,
		async awakeActivity() {
			const active = await Promise.all(
				(await sessions.list({ open: true })).map((session) => runtime().hasAwakeWork(session.id)),
			);
			return { active: active.filter(Boolean).length };
		},
		models: async () => {
			await runtime().refreshModels();
			return {
				providers: await modelCatalog(runtime(), [
					...Object.keys(config.models?.providers ?? {}),
					...(config.defaultModel ? [config.defaultModel.split("/")[0]!] : []),
				]),
				permissions: permissions(),
				cloud: { issues: structuredClone(runtime().cloud.issues) },
			};
		},
		workspaces: async (request: { id?: string; deviceId?: string; path?: string }, signal: AbortSignal) => ({
			...(await workspaces.list(request, signal, request.id ? await runtime().sessionConfig(request.id) : undefined)),
			permissions: permissions(),
		}),
		async open(request: Parameters<SessionsAPI["open"]>[0], options: SessionOptions, signal: AbortSignal) {
			await validate(options, signal);
			const session = await sessions.open(request);
			try {
				await set(session.id, options, signal);
				return session;
			} catch (error) {
				await sessions.close(session.id);
				throw error;
			}
		},
	};
}
