import { readFile } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginDescriptor } from "@yonder/bot-core/plugins/index";
import type { PluginModule } from "@yonder/sdk";
import type { PluginManifest } from "@yonder/sdk/registrations";
import { checkRegistrations } from "@yonder/sdk/testing";

/** The shipped network/data plugins are shared with the local Bot, including their original assets. */
export const cloudPlugins = ["agent-presets", "memory", "tasks", "cron", "market", "web-tools", "channel-card"];

export async function cloudPluginDescriptors(card: PluginModule): Promise<PluginDescriptor[]> {
	return Promise.all(
		cloudPlugins.map(async (id) => {
			const use = `@yonder/plugin-${id}`;
			const manifestPath = findPackageJSON(use, import.meta.url);
			if (!manifestPath) throw new Error(`Missing shipped plugin: ${use}`);
			const directory = dirname(manifestPath);
			const pkg = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string; yonder: PluginManifest };
			const manifest = pkg.yonder;
			const module: PluginModule =
				id === "channel-card" ? card : (await import(pathToFileURL(resolve(directory, manifest.entry)).href)).default;
			return {
				use,
				directory,
				version: pkg.version,
				manifest,
				module,
				check: async (registrations) => checkRegistrations(manifest, registrations, directory),
			};
		}),
	);
}
