import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Hook } from "@yonder/sdk";
import type { YonderConfig } from "../config/index.js";
import { loadPlugins } from "../plugins/index.js";
import { inspectionServices } from "./workspace.js";

/**
 * Hooks registered by the real official social plugin, loaded through the kernel's own plugin loader.
 * Tests use this instead of a fake policy: the participation decisions they assert are the ones production runs.
 *
 * The loader is imported dynamically so this test helper stays out of the static layering of `routing`
 * (check-layers), and the directory is the workspace checkout so vitest sees the plugin sources.
 */
export async function socialPluginHooks(): Promise<Map<string, Hook[]>> {
	const home = await mkdtemp(join(tmpdir(), "yonder-social-hooks-"));
	try {
		const config = { schema: 1, plugins: [{ use: resolve("plugins/social") }] } as YonderConfig;
		const loaded = await loadPlugins(
			home,
			config,
			inspectionServices(home, config, () => {}),
		);
		const hooks = loaded.hooks.get("social");
		if (!hooks?.some((hook) => typeof hook.participation === "function"))
			throw new Error("The official social plugin did not register a participation hook");
		return loaded.hooks;
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}
