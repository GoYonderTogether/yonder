import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_VERSION } from "@yonder/sdk";
import { expect, it } from "vitest";
import type { KernelServices } from "./index.js";
import { loadPlugins } from "./index.js";

async function writePlugin(home: string, id: string, apiVersion: number | undefined): Promise<string> {
	const directory = join(home, id);
	await mkdir(directory);
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({
			version: "1.0.0",
			type: "module",
			yonder: { ...(apiVersion === undefined ? {} : { apiVersion }), id, entry: "./index.mjs", contributes: {} },
		}),
	);
	await writeFile(join(directory, "index.mjs"), "export default { setup() {} };");
	return directory;
}

it("loads apiVersion 1 and missing apiVersion, and skips a newer apiVersion without blocking other plugins", async () => {
	expect(API_VERSION).toBe(1);
	const home = await mkdtemp(join(tmpdir(), "ya-api-"));
	try {
		const current = await writePlugin(home, "api-current", 1);
		const future = await writePlugin(home, "api-future", 2);
		const missing = await writePlugin(home, "api-missing", undefined);
		const errors: Array<{ message: string; data: unknown }> = [];
		const plugins = await loadPlugins(
			home,
			{ schema: 1, plugins: [{ use: current }, { use: future }, { use: missing }] },
			{
				log: { error: (message: string, data: unknown) => errors.push({ message, data }) },
			} as unknown as KernelServices,
		);
		expect(plugins.info?.map((plugin) => plugin.id)).toEqual(["api-current", "api-missing"]);
		expect(errors).toEqual([
			{
				message: "Plugin needs a newer Yonder (需要更新的 Yonder)",
				data: { plugin: "api-future", apiVersion: 2, supported: 1 },
			},
		]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
