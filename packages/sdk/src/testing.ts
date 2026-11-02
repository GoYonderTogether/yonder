import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import type { PluginManifest, Registrations } from "./registrations.js";
import { createRegistrationCollector, registrationSlots, validateRegistrations } from "./registrations.js";
import type { PluginAPI, PluginModule } from "./types.js";
import { API_VERSION } from "./version.js";

export type { PluginManifest, Registrations } from "./registrations.js";
export { createRegistrationCollector } from "./registrations.js";

export { tempHome, tempHomeSync, tempRoot } from "./testing-temp.js";

export async function readPluginManifest(dir: string): Promise<PluginManifest> {
	const { yonder: manifest } = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
		yonder?: PluginManifest;
	};
	const id = manifest?.id ?? dir;
	if (!manifest || typeof manifest.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(manifest.id))
		throw new Error(`${id}: invalid plugin id`);
	if (["message", "task", "session", "identity", "agent", "skill", "tool", "release"].includes(manifest.id))
		throw new Error(`${id}: reserved plugin id`);
	// Missing apiVersion means 1; older versions stay loadable, newer ones need a newer Yonder (04 §6).
	manifest.apiVersion ??= 1;
	if (!Number.isInteger(manifest.apiVersion)) throw new Error(`${id}: invalid apiVersion ${manifest.apiVersion}`);
	if (manifest.apiVersion > API_VERSION)
		throw new Error(
			`${id}: requires a newer Yonder (apiVersion ${manifest.apiVersion}; supported up to ${API_VERSION})`,
		);
	if (typeof manifest.entry !== "string" || !manifest.entry) throw new Error(`${id}: missing entry`);
	if (!manifest.contributes || typeof manifest.contributes !== "object" || Array.isArray(manifest.contributes))
		throw new Error(`${id}: invalid contributes`);
	for (const [slot, names] of Object.entries(manifest.contributes)) {
		if (
			!registrationSlots.includes(slot as (typeof registrationSlots)[number]) ||
			!Array.isArray(names) ||
			names.some((name) => typeof name !== "string" || !name)
		)
			throw new Error(`${id}: invalid contributes.${slot}`);
	}
	return manifest;
}
export async function checkRegistrations(
	manifest: PluginManifest,
	registrations: Registrations,
	dir: string,
): Promise<string[]> {
	const skillNames: string[] = [];
	const skillErrors: string[] = [];
	const report = (message: string) => skillErrors.push(`${manifest.id}: ${message}`);
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
				else skillNames.push(data.name);
			}
		} catch (error) {
			report(`skills ${registeredDir}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return validateRegistrations(manifest, registrations, skillNames, skillErrors);
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
			permissions: { ...api.permissions, list: unavailable, invoke: unavailable },
			id,
			version: JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version,
			locale: "zh-CN",
			timezone: "Asia/Shanghai",
			config: undefined,
			log: { info: log, warn: log, error: log },
			events: { ...api.events, emit: unavailable, ask: unavailable, query: unavailable },
			messages: { send: unavailable },
			agents: { list: unavailable, configureBinding: unavailable, inspectBinding: unavailable },
			credentials: { get: unavailable },
			execution: { capture: unavailable, resolve: unavailable, run: unavailable },
			services: { resolve: unavailable },
			host: { status: unavailable, modelReady: unavailable },
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
			subagents: { run: unavailable },
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
			storage: {
				open: () => new Proxy({} as import("./plugin-storage.js").PluginFiles, { get: unavailable }),
				writeAttachment: unavailable,
			},
		});
		return await checkRegistrations(manifest, registrations, dir);
	} catch (error) {
		return [`${id}: ${error instanceof Error ? error.message : String(error)}`];
	}
}

export { createFilePluginStorage } from "./node-storage.js";

export { createTriggerScheduler } from "./trigger-scheduler.js";
