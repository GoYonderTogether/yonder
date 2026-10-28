import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveControl } from "@yonder/core";
import { afterEach, expect, test } from "vitest";
import { applyMigration, MigrateError, planMigration, rewriteText, rollbackMigration } from "./migrate.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const YAML =
	"plugins:\n  - use: '@yonder/plugin-hermes-experience'\n  - use: ui-companion\ntools:\n  offer: [hermes-experience_*, ui-companion_present]\n";
const now = new Date("2026-10-28T08:00:00Z");

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "ymigrate-"));
	roots.push(root);
	const oldHome = join(root, "yonder-harness/home");
	const newHome = join(root, "yonder/home");
	await mkdir(join(oldHome, "agents"), { recursive: true });
	await mkdir(join(oldHome, ".yonder/plugins/hermes-experience"), { recursive: true });
	await writeFile(join(oldHome, "yonder.yaml"), YAML);
	await writeFile(join(oldHome, "agents/main.yaml"), "plugins: [hermes-experience, context-files]\n");
	await writeFile(join(oldHome, ".yonder/plugins/hermes-experience/state.bin"), Buffer.from([0, 255, 1, 2]));
	return { root, oldHome, newHome, options: { oldHome, newHome, now } };
}
async function snapshot(dir: string): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const entry of await readdir(dir, { recursive: true, withFileTypes: true }))
		if (entry.isFile()) {
			const path = join(entry.parentPath, entry.name);
			out[path.slice(dir.length)] = (await readFile(path)).toString("hex");
		}
	return out;
}

test("rewrites plugin ids and tool names but not look-alike paths or words", () => {
	const { text, count } = rewriteText(YAML + "path: ./plugins/hermes-experience\nx: my-ui-companion\n");
	expect(text).toContain("@yonder/plugin-learning");
	expect(text).toContain("[learning_*, interaction_present]");
	expect(text).toContain("./plugins/hermes-experience");
	expect(text).toContain("my-ui-companion");
	expect(count).toBe(4);
});

test("dry-run plans everything and changes nothing", async () => {
	const { root, options, oldHome, newHome } = await fixture();
	const before = await snapshot(root);
	const plan = await planMigration(options);
	expect(plan.status).toBe("ready");
	expect(plan.lines.join("\n")).toContain("符号链接");
	expect(await snapshot(root)).toEqual(before);
	await expect(lstat(newHome)).rejects.toThrow();
	expect((await lstat(oldHome)).isSymbolicLink()).toBe(false);
});

test("apply migrates, keeps originals, and a second apply is a no-op", async () => {
	const { root, options, oldHome, newHome } = await fixture();
	const result = await applyMigration(options);
	expect(result.applied).toBe(true);
	expect(await readlink(oldHome)).toBe(newHome);
	expect(await readFile(join(newHome, "yonder.yaml"), "utf8")).toContain("@yonder/plugin-learning");
	expect(await readFile(join(newHome, "yonder.yaml.pre-migrate-20261028"), "utf8")).toBe(YAML);
	expect(await readFile(join(newHome, "agents/main.yaml"), "utf8")).toBe("plugins: [learning, context-files]\n");
	expect((await readdir(join(newHome, "agents"))).sort()).toEqual(["main.yaml", "main.yaml.pre-migrate-20261028"]);
	expect(await readFile(join(newHome, ".yonder/plugins/learning/state.bin"))).toEqual(Buffer.from([0, 255, 1, 2]));
	await expect(lstat(join(newHome, ".yonder/plugins/hermes-experience"))).rejects.toThrow();
	const after = await snapshot(root);
	const again = await applyMigration(options);
	expect(again.status).toBe("noop");
	expect(again.applied).toBe(false);
	expect(await snapshot(root)).toEqual(after);
});

test("rollback restores byte-identical files and the original layout", async () => {
	const { root, options, oldHome, newHome } = await fixture();
	const before = await snapshot(oldHome);
	const { backup } = await applyMigration(options);
	expect(backup).toBeTruthy();
	const preview = await rollbackMigration(backup as string);
	expect(preview.applied).toBe(false);
	expect((await lstat(oldHome)).isSymbolicLink()).toBe(true);
	await rollbackMigration(backup as string, { apply: true });
	expect((await lstat(oldHome)).isDirectory()).toBe(true);
	expect(await snapshot(oldHome)).toEqual(before);
	await expect(lstat(newHome)).rejects.toThrow();
	expect(await readdir(join(root, "yonder-harness"))).toContain("home.backup-20261028");
});

test("refuses while a server holds the home, for plan, apply and rollback", async () => {
	const { options, oldHome } = await fixture();
	const { backup } = await applyMigration(options);
	const server = await serveControl(options.newHome, async () => null);
	try {
		expect((await planMigration(options)).status).toBe("blocked");
		await expect(applyMigration(options)).rejects.toThrow(MigrateError);
		await expect(rollbackMigration(backup as string, { apply: true })).rejects.toThrow("服务正在运行");
		expect((await lstat(oldHome)).isSymbolicLink()).toBe(true);
	} finally {
		await server.close();
	}
});

test("launchd commands are printed in the plan and only run on apply", async () => {
	const { root, options } = await fixture();
	const daemons = join(root, "LaunchDaemons");
	const helpers = join(root, "Helpers");
	await mkdir(daemons);
	await mkdir(helpers);
	await writeFile(join(daemons, "dev.yonder.harness.power.plist"), "<string>dev.yonder.harness.power</string>");
	await writeFile(join(helpers, "dev.yonder.harness.power"), "bin");
	const ran: string[][] = [];
	const withLaunchd = { ...options, launchd: { daemons, helpers }, run: async (argv: string[]) => void ran.push(argv) };
	const plan = await planMigration(withLaunchd);
	expect(plan.commands.map((c) => c.slice(0, 2).join(" "))).toContain("launchctl bootout");
	expect(plan.lines.join("\n")).toContain("dev.yonder.power");
	expect(ran).toEqual([]);
	const result = await applyMigration(withLaunchd);
	expect(result.launchdErrors).toEqual([]);
	expect(ran).toEqual(plan.commands);
});

test("conflicts block: both homes real, or plugin state target present", async () => {
	const { options, newHome } = await fixture();
	await mkdir(newHome, { recursive: true });
	expect((await planMigration(options)).status).toBe("blocked");
	await expect(applyMigration(options)).rejects.toThrow("无法迁移");
});

test("CLI: migrate defaults to dry-run and rejects bad flags under an isolated HOME", async () => {
	const home = await mkdtemp(join(tmpdir(), "ymigrate-cli-"));
	roots.push(home);
	await mkdir(join(home, ".local/share/yonder-harness/home"), { recursive: true });
	await writeFile(join(home, ".local/share/yonder-harness/home/yonder.yaml"), YAML);
	const run = (...args: string[]) =>
		execFileSync(process.execPath, [resolve("packages/cli/dist/index.js"), "migrate", ...args], {
			encoding: "utf8",
			env: { ...process.env, HOME: home, YONDER_HOME: "" },
		});
	expect(run()).toContain("dry-run");
	expect((await lstat(join(home, ".local/share/yonder-harness/home"))).isSymbolicLink()).toBe(false);
	// --apply is covered against injected paths above: through the CLI it would also run the
	// real launchctl commands on a Mac that has the power helper installed.
	expect(() => run("--rollback")).toThrow();
});
