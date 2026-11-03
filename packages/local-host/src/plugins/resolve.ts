import { readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { KernelServices, PluginDescriptor } from "@yonder/bot-core/plugins/index";
import type { YonderConfig } from "@yonder/local-host/config/index";
import { API_VERSION, type PluginModule } from "@yonder/sdk";
import { checkRegistrations, readPluginManifest } from "@yonder/sdk/testing";
export async function pluginDirectory(home: string, use: string): Promise<string> {
	if (isAbsolute(use) || use.startsWith(".")) return resolve(home, use);
	const homeParent = pathToFileURL(join(home, "yonder-loader.mjs")).href;
	let manifest: string | undefined;
	try {
		manifest = findPackageJSON(use, homeParent);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
		manifest = findPackageJSON(use, import.meta.url);
	}
	if (!manifest) throw new Error(`Cannot find plugin package root for ${use}`);
	return dirname(manifest);
}

export async function resolvePlugins(
	home: string,
	config: YonderConfig,
	log: KernelServices["log"],
): Promise<PluginDescriptor[]> {
	const descriptors: PluginDescriptor[] = [];
	for (const entry of config.plugins ?? []) {
		const directory = await pluginDirectory(home, entry.use);
		const pkg = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
		const apiVersion = pkg.yonder?.apiVersion ?? 1;
		if (typeof apiVersion === "number" && apiVersion > API_VERSION) {
			log.error("Plugin needs a newer Yonder (需要更新的 Yonder)", {
				plugin: String(pkg.yonder?.id ?? entry.use),
				apiVersion,
				supported: API_VERSION,
			});
			continue;
		}
		const manifest = await readPluginManifest(directory);
		if (typeof pkg.version !== "string" || !pkg.version) throw new Error(`${manifest.id}: missing package version`);
		const plugin = (await import(pathToFileURL(resolve(directory, manifest.entry)).href)).default as PluginModule;
		if (typeof plugin?.setup !== "function")
			throw new Error(`${manifest.id}: entry default export must provide setup(api)`);
		descriptors.push({
			manifest,
			module: plugin,
			directory,
			use: entry.use,
			version: pkg.version,
			...(pkg.deprecated === true ? { deprecated: true } : {}),
			...(entry.config === undefined ? {} : { config: entry.config }),
			check: (registrations) => checkRegistrations(manifest, registrations, directory),
		});
	}
	return descriptors;
}
