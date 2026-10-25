import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, it, vi } from "vitest";
import { createPermissions } from "../permissions.js";
import { createPermissionsTool } from "../tools/permissions.js";
import { type KernelServices, loadPlugins } from "./index.js";

async function fixture(setup: string, declared = ["permission-test.os"]) {
	const home = await mkdtemp("/tmp/yonder-permission-loader-");
	await writeFile(
		join(home, "package.json"),
		JSON.stringify({
			type: "module",
			version: "0.0.0",
			yonder: {
				apiVersion: 1,
				id: "permission-test",
				entry: "index.mjs",
				contributes: { permissions: declared, tools: ["permission-test_invoke"] },
			},
		}),
	);
	await writeFile(
		join(home, "index.mjs"),
		`export default { setup(api) {
${setup}
api.tools.register({ name: "permission-test_invoke", capabilities: [], parameters: { type: "object" },
execute: async (request, ctx) => ({ text: JSON.stringify(await api.permissions.invoke(request, ctx)) }) });
} };`,
	);
	return home;
}
const register = `api.permissions.register({ id: "permission-test.os", scope: "loader contract test", kinds: ["camera"],
async invoke(request, ctx) { return { platform: "contract-test", result: { action: request.action, session: ctx.session, state: "unknown" } }; } });`;
const ctx: ToolContext = {
	agent: null,
	profile: "test",
	session: "1",
	capabilities: [],
	env: { id: "node:local" } as ToolContext["env"],
	signal: new AbortController().signal,
};
it("plugin facade and core tool use the very same registry and profile selection", async () => {
	const home = await fixture(register);
	const selected = ["permission-test"];
	const registry = createPermissions(async (actual) => {
		expect(actual).toBe(ctx);
		return selected;
	});
	try {
		const loaded = await loadPlugins(home, { schema: 1, plugins: [{ use: home }] }, {
			permissions: registry,
		} as KernelServices);
		const request = { provider: "permission-test.os", kind: "camera", action: "status" } as const;
		const pluginTool = loaded.tools.get("permission-test")?.[0];
		expect(pluginTool).toBeDefined();
		const coreTool = createPermissionsTool(registry);
		expect(await pluginTool?.execute(request, ctx)).toEqual(await coreTool.execute(request, ctx));
		selected.splice(0);
		await expect(pluginTool?.execute(request, ctx)).rejects.toThrow("not enabled");
		expect((await coreTool.execute(request, ctx)).isError).toBe(true);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
it.each(["invoke", "list"])("setup/validation cannot call permissions.%s", async (method) => {
	const home = await fixture(`api.permissions.${method}({}, {});`);
	const invoke = vi.fn();
	const list = vi.fn();
	try {
		await expect(
			loadPlugins(home, { schema: 1, plugins: [{ use: home }] }, {
				permissions: { invoke, list },
			} as unknown as KernelServices),
		).rejects.toThrow("not allowed during setup");
		expect((await checkPlugin(home)).join("\n")).toContain("only supports registration");
		expect(invoke).not.toHaveBeenCalled();
		expect(list).not.toHaveBeenCalled();
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
it("validation registers without executing a permission request", async () => {
	const home = await fixture(
		register.replace(
			"return { platform:",
			'throw new Error("must never invoke during validation"); return { platform:',
		),
	);
	try {
		expect(await checkPlugin(home)).toEqual([]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
it("loader rejects a provider trying to claim another plugin namespace", async () => {
	const home = await fixture(register.replace('id: "permission-test.os"', 'id: "other-plugin"'), ["other-plugin"]);
	const registry = createPermissions(async () => []);
	try {
		await expect(
			loadPlugins(home, { schema: 1, plugins: [{ use: home }] }, { permissions: registry } as KernelServices),
		).rejects.toThrow("expected own plugin namespace");
		expect(await registry.list(ctx)).toEqual([]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
