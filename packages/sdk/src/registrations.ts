import type {
	ChannelProvider,
	ContextContribution,
	EnvProvider,
	Hook,
	PermissionProvider,
	PluginAPI,
	Preset,
	Tool,
	Trigger,
	ViewDecl,
	ViewProvider,
	YEvent,
} from "./types.js";

export const registrationSlots = [
	"views",
	"channels",
	"tools",
	"contexts",
	"triggers",
	"envs",
	"hooks",
	"presets",
	"skills",
	"permissions",
] as const;
type Slot = (typeof registrationSlots)[number];
export interface PluginManifest {
	apiVersion: number;
	id: string;
	entry: string;
	contributes: Partial<Record<Slot, string[]>>;
}
export interface Registrations {
	views: Array<{ decl: ViewDecl; provider: ViewProvider }>;
	permissions: PermissionProvider[];
	channels: ChannelProvider[];
	tools: Tool[];
	contexts: ContextContribution[];
	triggers: Trigger[];
	envs: EnvProvider[];
	hooks: Hook[];
	presets: Preset[];
	skills: string[];
	listeners: Array<{ type: string; handler: (event: YEvent) => void | Promise<void> }>;
}

export function createRegistrationCollector() {
	const registrations: Registrations = {
		views: [],
		permissions: [],
		channels: [],
		tools: [],
		contexts: [],
		triggers: [],
		envs: [],
		hooks: [],
		presets: [],
		skills: [],
		listeners: [],
	};
	const collect = <T>(items: T[]) => ({
		register: (item: T): void => {
			items.push(item);
		},
	});
	const api = {
		invalidate: (_ids?: string[], _badge?: number): void => {},
		views: {
			register: (decl: ViewDecl, provider: ViewProvider): void => {
				registrations.views.push({ decl, provider });
			},
		},
		permissions: collect(registrations.permissions),
		channels: collect(registrations.channels),
		tools: collect(registrations.tools),
		contexts: collect(registrations.contexts),
		triggers: collect(registrations.triggers),
		envs: collect(registrations.envs),
		hooks: collect(registrations.hooks),
		presets: collect(registrations.presets),
		skills: collect(registrations.skills),
		events: {
			on: (type: string, handler: (event: YEvent) => void | Promise<void>): void => {
				registrations.listeners.push({ type, handler });
			},
		},
	};
	return { registrations, api };
}

/** Check registration shape and manifest agreement without reading plugin files. */
export function validateRegistrations(
	manifest: PluginManifest,
	registrations: Registrations,
	skillNames: string[] = [],
	skillErrors: string[] = [],
): string[] {
	const errors: string[] = [];
	const report = (message: string) => errors.push(`${manifest.id}: ${message}`);
	const names: Record<Slot, string[]> = {
		views: registrations.views.map((value) => value.decl.id),
		permissions: registrations.permissions.map((value) => value.id),
		channels: registrations.channels.map((value) => value.type),
		envs: registrations.envs.map((value) => value.type),
		tools: registrations.tools.map((value) => value.name),
		contexts: registrations.contexts.map((value) => value.id),
		triggers: registrations.triggers.map((value) => value.id),
		hooks: registrations.hooks.map((value) => value.id),
		presets: registrations.presets.map((value) => value.id),
		skills: skillNames,
	};
	for (const { decl, provider } of registrations.views) {
		if (
			decl.plugin !== manifest.id ||
			!decl.id.startsWith(`${manifest.id}.`) ||
			decl.id.length <= manifest.id.length + 1
		)
			report(`view ${decl.id}: expected own plugin namespace`);
		if (
			!["rail", "floating", "page"].includes(decl.placement) ||
			!["session", "node"].includes(decl.scope) ||
			typeof provider.data !== "function"
		)
			report(`view ${decl.id}: invalid provider contract`);
	}
	for (const provider of registrations.permissions) {
		if (typeof provider.id !== "string" || (provider.id !== manifest.id && !provider.id.startsWith(`${manifest.id}.`)))
			report(`permission ${provider.id}: expected own plugin namespace`);
		if (
			typeof provider.id !== "string" ||
			!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)?$/.test(provider.id) ||
			typeof provider.scope !== "string" ||
			!provider.scope.trim() ||
			!Array.isArray(provider.kinds) ||
			!provider.kinds.length ||
			provider.kinds.some((kind) => typeof kind !== "string" || !kind.trim()) ||
			new Set(provider.kinds).size !== provider.kinds.length ||
			typeof provider.invoke !== "function"
		)
			report(`permission ${provider.id}: invalid provider contract`);
	}
	for (const tool of registrations.tools) {
		if (!Array.isArray(tool.capabilities)) report(`tool ${tool.name}: capabilities must be declared`);
		if (
			typeof tool.name !== "string" ||
			!tool.name.startsWith(`${manifest.id}_`) ||
			!/^[a-z][a-z0-9_-]{0,63}$/.test(tool.name)
		)
			report(`tool ${tool.name}: invalid name; expected ${manifest.id}_ prefix`);
	}
	errors.push(...skillErrors);
	for (const slot of registrationSlots) {
		const declared = manifest.contributes[slot] ?? [];
		for (const [label, entries] of [
			["declared", declared],
			["registered", names[slot]],
		] as const) {
			const seen = new Set<string>();
			for (const name of entries) {
				if (typeof name !== "string" || !name) report(`${slot}: invalid ${label} name`);
				else if (seen.has(name)) report(`${slot}.${name}: duplicate ${label} contribution`);
				seen.add(name);
			}
		}
		for (const name of names[slot])
			if (!declared.includes(name)) report(`${slot}.${name}: registered but not declared`);
		for (const name of declared)
			if (!names[slot].includes(name)) report(`${slot}.${name}: declared but not registered`);
	}
	return errors;
}
