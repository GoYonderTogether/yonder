import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type KernelServices, registerPlugins } from "@yonder/bot-core/plugins/index";
import type { YonderConfig } from "@yonder/local-host/config/index";
import { createFilePluginStorage } from "@yonder/sdk/node-storage";
import { createTriggerScheduler } from "@yonder/sdk/trigger-scheduler";
import { resolvePlugins } from "./resolve.js";

export * from "@yonder/bot-core/plugins/index";
export { pluginDirectory, resolvePlugins } from "./resolve.js";
export const pluginDataPath = (home: string, id: string) => join(home, ".yonder", "plugins", id);
export async function loadPlugins(home: string, config: YonderConfig, services: KernelServices) {
	const scheduler = createTriggerScheduler((key, error) =>
		services.log.error("Plugin scheduled tick failed", { trigger: key, error: String(error) }),
	);
	const descriptors = await resolvePlugins(home, config, services.log);
	const version = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version;
	const loaded = await registerPlugins(
		{
			descriptors,
			version,
			dataPath: (id) => pluginDataPath(home, id),
			storage: (id) => createFilePluginStorage(pluginDataPath(home, id)),
			scheduler,
		},
		config,
		services,
	);
	return {
		...loaded,
		async stop() {
			try {
				await loaded.stop();
			} finally {
				await scheduler.stop();
			}
		},
	};
}
