import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import type {
	ChannelProvider,
	ContextContribution,
	EnvProvider,
	Hook,
	PluginAPI,
	PluginModule,
	Preset,
	Tool,
	Trigger,
	YEvent,
} from "./types.js";

const slots = ["channels", "tools", "contexts", "triggers", "envs", "hooks", "presets", "skills"] as const;
type Slot = (typeof slots)[number];
export interface PluginManifest {
	apiVersion: number;
	id: string;
	entry: string;
	contributes: Partial<Record<Slot, string[]>>;
}
export interface Registrations {
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

export async function readPluginManifest(dir: string): Promise<PluginManifest> {
	const { yonder: manifest } = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
		yonder?: PluginManifest;
	};
	const id = manifest?.id ?? dir;
	if (!manifest || typeof manifest.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(manifest.id))
		throw new Error(`${id}: invalid plugin id`);
	if (["message", "task", "session", "identity", "agent", "skill", "tool", "release"].includes(manifest.id))
		throw new Error(`${id}: reserved plugin id`);
	if (manifest.apiVersion !== 1) throw new Error(`${id}: unsupported apiVersion ${manifest.apiVersion}; supported: 1`);
	if (typeof manifest.entry !== "string" || !manifest.entry) throw new Error(`${id}: missing entry`);
	if (!manifest.contributes || typeof manifest.contributes !== "object" || Array.isArray(manifest.contributes))
		throw new Error(`${id}: invalid contributes`);
	for (const [slot, names] of Object.entries(manifest.contributes)) {
		if (
			!slots.includes(slot as Slot) ||
			!Array.isArray(names) ||
			names.some((name) => typeof name !== "string" || !name)
		)
			throw new Error(`${id}: invalid contributes.${slot}`);
	}
	return manifest;
}

export function createRegistrationCollector() {
	const registrations: Registrations = {
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

export async function checkRegistrations(
	manifest: PluginManifest,
	registrations: Registrations,
	dir: string,
): Promise<string[]> {
	const errors: string[] = [];
	const report = (message: string) => errors.push(`${manifest.id}: ${message}`);
	const names: Record<Slot, string[]> = {
		channels: registrations.channels.map((value) => value.type),
		envs: registrations.envs.map((value) => value.type),
		tools: registrations.tools.map((value) => value.name),
		contexts: registrations.contexts.map((value) => value.id),
		triggers: registrations.triggers.map((value) => value.id),
		hooks: registrations.hooks.map((value) => value.id),
		presets: registrations.presets.map((value) => value.id),
		skills: [],
	};
	for (const tool of registrations.tools) {
		if (!Array.isArray(tool.capabilities)) report(`tool ${tool.name}: capabilities must be declared`);
		if (
			typeof tool.name !== "string" ||
			!tool.name.startsWith(`${manifest.id}_`) ||
			!/^[a-z][a-z0-9_-]{0,63}$/.test(tool.name)
		)
			report(`tool ${tool.name}: invalid name; expected ${manifest.id}_ prefix`);
	}
	for (const registeredDir of registrations.skills) {
		try {
			const root = await realpath(dir);
			const skillDir = await realpath(resolve(dir, registeredDir));
			const location = relative(root, skillDir);
			if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location))
				throw new Error("skill directory must be inside the plugin package");
			for (const file of await readdir(skillDir, { recursive: true, withFileTypes: true })) {
				if (!file.isFile() || file.name !== "SKILL.md") continue;
				const filename = join(file.parentPath, file.name);
				const text = await readFile(filename, "utf8");
				const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
				const data = frontmatter === undefined ? undefined : parse(frontmatter);
				if (
					!data ||
					typeof data.name !== "string" ||
					data.name.length > 64 ||
					!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) ||
					typeof data.description !== "string" ||
					!data.description.trim() ||
					data.description.length > 1024
				)
					report(`skill ${filename}: invalid name or description`);
				else names.skills.push(data.name);
			}
		} catch (error) {
			report(`skills ${registeredDir}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	for (const slot of slots) {
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

export async function checkPlugin(dir: string): Promise<string[]> {
	let id = dir;
	try {
		const manifest = await readPluginManifest(dir);
		id = manifest.id;
		const module = (await import(pathToFileURL(resolve(dir, manifest.entry)).href)).default as PluginModule;
		if (typeof module?.setup !== "function") throw new Error("entry default export must provide setup(api)");
		const { registrations, api } = createRegistrationCollector();
		const unavailable = (): never => {
			throw new Error("checkPlugin only supports registration during setup");
		};
		const logged: unknown[] = [];
		const log = (...args: unknown[]) => {
			logged.push(args);
		};
		await module.setup({
			...api,
			id,
			version: JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version,
			locale: "zh-CN",
			timezone: "Asia/Shanghai",
			config: undefined,
			log: { info: log, warn: log, error: log },
			events: { ...api.events, emit: unavailable, ask: unavailable, query: unavailable },
			messages: { send: unavailable },
			agents: { list: unavailable },
			credentials: { get: unavailable },
			execution: { resolve: unavailable, run: unavailable },
			services: { resolve: unavailable },
			sessions: {
				command: unavailable,
				notify: unavailable,
				list: unavailable,
				get: unavailable,
				open: unavailable,
				submit: unavailable,
				abort: unavailable,
				close: unavailable,
				transcript: unavailable,
			},
			identity: {
				account: unavailable,
				person: unavailable,
				createPerson: unavailable,
				link: unavailable,
				unlink: unavailable,
				relation: unavailable,
				lookup: unavailable,
			},
			models: new Proxy({} as PluginAPI["models"], { get: unavailable }),
			paths: { data: resolve(dir, ".yonder-contract-data") },
		});
		return await checkRegistrations(manifest, registrations, dir);
	} catch (error) {
		return [`${id}: ${error instanceof Error ? error.message : String(error)}`];
	}
}
