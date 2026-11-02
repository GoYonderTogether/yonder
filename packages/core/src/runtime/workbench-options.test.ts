import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { localEnvironment } from "./env.js";
import { ToolPolicy } from "./policy.js";
import { applyWorkbenchOptions } from "./workbench-options.js";

test("clearing explicit resources restores the base cwd and readonly can read both selected local roots", async () => {
	const home = await tempHome("ya-workspaces-");
	const a = join(home, "a"),
		b = join(home, "b"),
		outside = join(home, "outside");
	await Promise.all([a, b, outside].map((path) => mkdir(path)));
	await writeFile(join(b, "text"), "selected file");
	const base = { agent: null, profile: "task", cwd: a, resolved: resolveProfile({ level: "readonly" }) };
	try {
		expect(
			applyWorkbenchOptions(base, { resources: [], defaultWorkspace: { deviceId: "remote", path: "/remote" } }).cwd,
		).toBe(a);
		const mixed = applyWorkbenchOptions(base, {
			resources: [
				{ deviceId: "remote", paths: ["/remote"] },
				{ deviceId: "local", paths: [b] },
			],
		});
		expect(mixed.cwd).toBe(b);
		expect(mixed.resolved.env).toBe("local");
		expect(mixed.resolved.tools.offer).toContain("devices_operation");
		const selected = applyWorkbenchOptions(base, { resources: [{ deviceId: "local", paths: [a, b] }] });
		const policy = new ToolPolicy({
			home,
			capabilities: new Map([
				["read", ["read"]],
				["bash", ["exec"]],
			]),
			environment: (config) => localEnvironment(config.cwd),
			context: async () => ({
				agent: null,
				profile: "task",
				session: "1",
				capabilities: ["read"],
				env: localEnvironment(a),
				signal: new AbortController().signal,
			}),
		});
		expect(await policy.denied("read", { path: join(b, "text") }, selected, BACKGROUND_CONTEXT, "1")).toBeUndefined();
		expect(await policy.denied("read", { path: outside }, selected, BACKGROUND_CONTEXT, "1")).toContain("工作目录");
		const bypass = { ...selected, resolved: resolveProfile({ level: "bypass" }) };
		expect(await policy.denied("bash", { cwd: outside, command: "pwd" }, bypass, BACKGROUND_CONTEXT, "1")).toContain(
			"工作目录",
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
