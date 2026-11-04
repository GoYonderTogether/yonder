import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	copyPlugin,
	detectHermes,
	enablePlugin,
	pluginsDir,
	removePlugin,
	removePluginDir,
} from "../src/hermes.js";
import { detectOpenclaw, installPlugin, pluginEntry, uninstallPlugin } from "../src/openclaw.js";
import { hermesStateDir, clearConfig, writeConfig, readConfig } from "../src/state.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "yonder-connect-ho-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

describe("hermes launcher detection", () => {
	test("finds hermes on PATH and resolves HERMES_HOME", () => {
		const home = temp();
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, "hermes"), "#!/bin/sh\n");
		const install = detectHermes({
			env: { PATH: bin, HERMES_HOME: join(home, "hermes-home") },
			home,
			version: () => "0.22.6",
		});
		expect(install.launcher).toBe(join(bin, "hermes"));
		expect(install.home).toBe(join(home, "hermes-home"));
		expect(install.version).toBe("0.22.6");
	});

	test("defaults the home to ~/.hermes when the launcher exists", () => {
		const home = temp();
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, "hermes"), "#!/bin/sh\n");
		const install = detectHermes({ env: { PATH: bin }, home, version: () => undefined });
		expect(install.home).toBe(join(home, ".hermes"));
	});

	test("reports a missing launcher instead of guessing", () => {
		expect(() => detectHermes({ env: { PATH: temp() }, home: temp(), exists: () => false })).toThrow(
			/找不到 hermes 命令/,
		);
	});
});

describe("hermes drop-in install", () => {
	function fakePluginSource(): string {
		const source = temp();
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "plugin.yaml"), "name: yonder-connector\nkind: platform\n");
		writeFileSync(join(source, "__init__.py"), "from .platform_adapter import register\n");
		return source;
	}

	test("copies the plugin into <HERMES_HOME>/plugins/yonder-connector", () => {
		const home = temp();
		const source = fakePluginSource();
		const target = copyPlugin(home, source);
		expect(target).toBe(join(pluginsDir(home), "yonder-connector"));
		expect(readFileSync(join(target, "plugin.yaml"), "utf8")).toContain("kind: platform");
	});

	test("refuses a source without plugin.yaml and an existing install", () => {
		const home = temp();
		const empty = temp();
		expect(() => copyPlugin(home, empty)).toThrow(/plugin.yaml/);
		const source = fakePluginSource();
		copyPlugin(home, source);
		expect(() => copyPlugin(home, source)).toThrow(/已存在/);
	});

	test("remove deletes the drop-in copy; remove is idempotent", () => {
		const home = temp();
		const source = fakePluginSource();
		const target = copyPlugin(home, source);
		expect(removePluginDir(home)).toBe(target);
		expect(removePluginDir(home)).toBeUndefined();
	});

	test("enable and remove surface hermes's own failure text", () => {
		const run = () => ({ status: 1, stdout: "", stderr: "plugin not found" });
		expect(() => enablePlugin("/x/hermes", {}, run)).toThrow(/plugin not found/);
		expect(() => removePlugin("/x/hermes", {}, run)).toThrow(/plugin not found/);
	});

	test("hermes state dir sits under <HERMES_HOME>/yonder and clears like dsh", () => {
		const home = temp();
		const dir = hermesStateDir(join(home, "hermes-home"));
		writeConfig(dir, { endpoint: "https://x.test", deviceToken: "secret" });
		expect(readConfig(dir)).toEqual({ endpoint: "https://x.test", deviceToken: "secret" });
		writeFileSync(join(dir, "state.json"), "{}");
		writeFileSync(join(dir, "keep.txt"), "keep");
		expect(clearConfig(dir).sort()).toEqual([join(dir, "config.json"), join(dir, "state.json")].sort());
		expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("keep");
	});
});

describe("openclaw launcher detection", () => {
	test("finds openclaw on PATH and resolves the state dir", () => {
		const home = temp();
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, "openclaw"), "#!/bin/sh\n");
		const install = detectOpenclaw({
			env: { PATH: bin },
			home,
			version: () => "2026.10.10",
		});
		expect(install.launcher).toBe(join(bin, "openclaw"));
		expect(install.stateDir).toBe(join(home, ".openclaw"));
		expect(install.version).toBe("2026.10.10");
	});

	test("OPENCLAW_STATE_DIR overrides the default state dir", () => {
		const home = temp();
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, "openclaw"), "#!/bin/sh\n");
		const install = detectOpenclaw({
			env: { PATH: bin, OPENCLAW_STATE_DIR: join(home, "oc") },
			home,
		});
		expect(install.stateDir).toBe(join(home, "oc"));
	});

	test("reports a missing launcher instead of guessing", () => {
		expect(() => detectOpenclaw({ env: { PATH: temp() }, home: temp(), exists: () => false })).toThrow(
			/找不到 openclaw 命令/,
		);
	});
});

describe("openclaw plugin install", () => {
	test("installs with the non-interactive flags", () => {
		const calls: string[][] = [];
		installPlugin({
			launcher: "/x/openclaw",
			spec: "npm-pack:/tmp/yonder.tgz",
			run: (command, args) => {
				calls.push([command, ...args]);
				return { status: 0, stdout: "", stderr: "" };
			},
		});
		expect(calls).toEqual([
			["/x/openclaw", "plugins", "install", "npm-pack:/tmp/yonder.tgz", "--force", "--accept-capabilities", "--no-prompt"],
		]);
	});

	test("uninstall uses the plugin id with the same flags", () => {
		const calls: string[][] = [];
		uninstallPlugin({
			launcher: "/x/openclaw",
			run: (command, args) => {
				calls.push([command, ...args]);
				return { status: 0, stdout: "", stderr: "" };
			},
		});
		expect(calls).toEqual([["/x/openclaw", "plugins", "uninstall", "yonder-connector", "--force", "--no-prompt"]]);
	});

	test("surfaces openclaw's own failure text", () => {
		expect(() =>
			installPlugin({
				launcher: "/x/openclaw",
				spec: "pkg",
				run: () => ({ status: 1, stdout: "", stderr: "UNSUPPORTED_SOURCE" }),
			}),
		).toThrow(/UNSUPPORTED_SOURCE/);
	});

	test("pluginEntry reads the enabled entry openclaw leaves behind", () => {
		const state = temp();
		mkdirSync(state, { recursive: true });
		writeFileSync(
			join(state, "openclaw.json"),
			JSON.stringify({ plugins: { entries: { "yonder-connector": { enabled: false } } } }),
		);
		expect(pluginEntry(state)).toEqual({ enabled: false });
		expect(pluginEntry(temp())).toBeUndefined();
	});
});
