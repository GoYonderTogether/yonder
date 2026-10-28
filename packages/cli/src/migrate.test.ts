import { execFileSync } from "node:child_process";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rename,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { serveControl } from "@yonder/core";
import { afterEach, expect, test } from "vitest";
import { applyMigration, MigrateError, planMigration, rewriteText } from "./migrate.js";
import { formatMigration, rollbackMigration } from "./migrate-rollback.js";

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

test("a launchd failure is reported apart from the finished data migration, with exact recovery commands", async () => {
	const { root, options, oldHome, newHome } = await fixture();
	const daemons = join(root, "LaunchDaemons");
	await mkdir(daemons);
	await writeFile(join(daemons, "dev.yonder.harness.power.plist"), "x");
	let n = 0;
	const run = async () => {
		if (++n === 2) throw new Error("boom");
	};
	const result = await applyMigration({ ...options, launchd: { daemons, helpers: join(root, "none") }, run });
	expect(result.applied).toBe(true);
	expect(await readlink(oldHome)).toBe(newHome);
	expect(result.launchdDone).toHaveLength(1);
	expect(result.launchdPending.map((c) => c[0])).toEqual(["sed", "mv", "launchctl"]);
	const text = formatMigration(result);
	expect(text).toContain("数据迁移：已完成");
	expect(text).toContain("launchd：已执行 1/4 条，失败：");
	expect(text).toContain(
		`sudo sed -i '' 's/dev\\.yonder\\.harness\\.power/dev.yonder.power/g' ${join(daemons, "dev.yonder.harness.power.plist")}`,
	);
});

test("conflicts block: both homes real, or plugin state target present", async () => {
	const { options, newHome } = await fixture();
	await mkdir(newHome, { recursive: true });
	expect((await planMigration(options)).status).toBe("blocked");
	await expect(applyMigration(options)).rejects.toThrow("无法迁移");
});

test("secret file modes survive apply and rollback", async () => {
	const { options, oldHome, newHome } = await fixture();
	await writeFile(join(oldHome, "auth.json"), "{}", { mode: 0o600 });
	await chmod(join(oldHome, "auth.json"), 0o600);
	const { backup } = await applyMigration(options);
	expect((await stat(join(newHome, "auth.json"))).mode & 0o777).toBe(0o600);
	expect((await stat(join(newHome, "yonder.yaml"))).mode & 0o777).toBe(
		(await stat(join(newHome, "yonder.yaml.pre-migrate-20261028"))).mode & 0o777,
	);
	await rollbackMigration(backup as string, { apply: true });
	expect((await stat(join(oldHome, "auth.json"))).mode & 0o777).toBe(0o600);
});

test("runtime sockets are left out of the backup on purpose", async () => {
	const { options, oldHome } = await fixture();
	// Bind in a short path (unix socket limit), then move the bound node into the home.
	const short = join("/tmp", `ym-${process.pid}.sock`);
	const server = createServer();
	await new Promise<void>((done) => server.listen(short, done));
	await mkdir(join(oldHome, ".yonder"), { recursive: true });
	await rename(short, join(oldHome, ".yonder/runtime.sock"));
	try {
		expect((await lstat(join(oldHome, ".yonder/runtime.sock"))).isSocket()).toBe(true);
		const { backup } = await applyMigration(options);
		await expect(lstat(join(backup as string, "home/.yonder/runtime.sock"))).rejects.toThrow();
		expect(await readFile(join(backup as string, "home/yonder.yaml"), "utf8")).toBe(YAML);
	} finally {
		server.close();
	}
});

test("a held home lock (the service's own) blocks apply", async () => {
	const { options, oldHome } = await fixture();
	const { lockHome } = await import("@yonder/core");
	await mkdir(join(oldHome, ".yonder"), { recursive: true });
	const unlock = await lockHome(oldHome);
	try {
		await expect(applyMigration(options)).rejects.toThrow("被服务占用");
		expect((await lstat(oldHome)).isSymbolicLink()).toBe(false);
	} finally {
		await unlock();
	}
});

test("half-done move (crash between the two renames) is finished by a rerun", async () => {
	const { options, oldHome, newHome, root } = await fixture();
	const tempLink = `${oldHome}.migrate-deadbeef`;
	await writeFile(join(oldHome, ".migrate-journal.json"), JSON.stringify({ version: 1, oldHome, newHome, tempLink }));
	await mkdir(join(root, "yonder"), { recursive: true });
	await rename(oldHome, newHome);
	await symlink(newHome, tempLink);
	await expect(lstat(oldHome)).rejects.toThrow();
	const dry = await planMigration(options);
	expect(dry.lines.join("\n")).toContain("中断");
	const result = await applyMigration(options);
	expect(result.applied).toBe(true);
	expect(await readlink(oldHome)).toBe(newHome);
	await expect(lstat(tempLink)).rejects.toThrow();
	await expect(lstat(join(newHome, ".migrate-journal.json"))).rejects.toThrow();
	expect(await readFile(join(newHome, "yonder.yaml"), "utf8")).toContain("@yonder/plugin-learning");
});

test("journal left before the move (nothing moved) is cleared and the move proceeds", async () => {
	const { options, oldHome, newHome } = await fixture();
	const tempLink = `${oldHome}.migrate-deadbeef`;
	await symlink(newHome, tempLink);
	await writeFile(join(oldHome, ".migrate-journal.json"), JSON.stringify({ version: 1, oldHome, newHome, tempLink }));
	await applyMigration(options);
	expect(await readlink(oldHome)).toBe(newHome);
	await expect(lstat(tempLink)).rejects.toThrow();
});

test("a failure mid-apply puts the home back at the old path", async () => {
	const { options, oldHome, newHome } = await fixture();
	// The plugin-state rename is the last step; a read-only parent makes it fail after the yaml rewrites.
	await chmod(join(oldHome, ".yonder/plugins"), 0o555);
	try {
		await expect(applyMigration(options)).rejects.toThrow("迁移中断");
	} finally {
		await chmod(join(oldHome, ".yonder/plugins"), 0o755);
		await chmod(join(dirname(oldHome), "home.backup-20261028/home/.yonder/plugins"), 0o755);
	}
	expect((await lstat(oldHome)).isDirectory()).toBe(true);
	await expect(lstat(newHome)).rejects.toThrow();
	expect(await readFile(join(oldHome, "yonder.yaml"), "utf8")).toBe(YAML);
	expect((await readdir(oldHome)).filter((n) => n.startsWith(".migrate-") || n.includes("pre-migrate"))).toEqual([]);
	expect((await readdir(dirname(oldHome))).filter((n) => n.includes(".migrate-"))).toEqual([]);
});

test("a server appearing just before the rename aborts cleanly and leaves no journal or temp link", async () => {
	const { options, oldHome, newHome } = await fixture();
	let calls = 0;
	// plan checks two homes, the post-lock check two more; the recheck right before rename is the fifth call.
	const running = async () => ++calls > 4;
	await expect(applyMigration({ ...options, running })).rejects.toThrow("迁移中断");
	expect((await lstat(oldHome)).isDirectory()).toBe(true);
	await expect(lstat(newHome)).rejects.toThrow();
	expect((await readdir(oldHome)).includes(".migrate-journal.json")).toBe(false);
	expect((await readdir(dirname(oldHome))).filter((n) => n.includes(".migrate-"))).toEqual([]);
});

test("rollback refuses data written after the migration unless --force", async () => {
	const { options, oldHome, newHome } = await fixture();
	const { backup } = await applyMigration(options);
	await new Promise((r) => setTimeout(r, 1100));
	await writeFile(join(newHome, "later.txt"), "new data");
	await expect(rollbackMigration(backup as string, { apply: true })).rejects.toThrow("--force");
	expect((await lstat(oldHome)).isSymbolicLink()).toBe(true);
	expect(await readFile(join(newHome, "later.txt"), "utf8")).toBe("new data");
	await rollbackMigration(backup as string, { apply: true, force: true });
	expect((await lstat(oldHome)).isDirectory()).toBe(true);
	await expect(lstat(join(oldHome, "later.txt"))).rejects.toThrow();
	await expect(lstat(newHome)).rejects.toThrow();
});

test("rollback refuses when the old path is not the symlink to new", async () => {
	const { options, oldHome } = await fixture();
	const { backup } = await applyMigration(options);
	await rm(oldHome);
	await mkdir(oldHome);
	await expect(rollbackMigration(backup as string, { apply: true })).rejects.toThrow("拒绝回滚");
	await utimes(oldHome, new Date(), new Date());
});

test("CLI --apply end to end in a temp HOME with a real no-op launchctl on PATH", async () => {
	const home = await mkdtemp(join(tmpdir(), "ymigrate-cli-"));
	roots.push(home);
	const share = join(home, ".local/share");
	await mkdir(join(share, "yonder-harness/home"), { recursive: true });
	await writeFile(join(share, "yonder-harness/home/yonder.yaml"), YAML);
	// Real executables, not a mock library. mv/sed are no-ops too so the real /Library is never touched
	// even on a Mac that still has the old power plist.
	const bin = join(home, "bin");
	const log = join(home, "calls.log");
	await mkdir(bin);
	for (const name of ["launchctl", "mv", "sed"]) {
		await writeFile(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
	}
	const run = (...args: string[]) =>
		execFileSync(process.execPath, [resolve("packages/cli/dist/index.js"), "migrate", ...args], {
			encoding: "utf8",
			env: { ...process.env, HOME: home, YONDER_HOME: "", PATH: bin + delimiter + dirname(process.execPath) },
		});
	expect(run()).toContain("dry-run");
	expect((await lstat(join(share, "yonder-harness/home"))).isSymbolicLink()).toBe(false);
	const out = run("--apply");
	expect(out).toContain("数据迁移：已完成");
	expect(await readlink(join(share, "yonder-harness/home"))).toBe(join(share, "yonder/home"));
	expect(await readFile(join(share, "yonder/home/yonder.yaml"), "utf8")).toContain("@yonder/plugin-learning");
	const calls = await readFile(log, "utf8").catch(() => "");
	if (
		await stat("/Library/LaunchDaemons/dev.yonder.harness.power.plist").then(
			() => true,
			() => false,
		)
	)
		expect(calls).toContain("launchctl bootout system/dev.yonder.harness.power");
	else expect(calls).toBe("");
	expect(run("--apply")).toContain("数据迁移");
	expect(await readlink(join(share, "yonder-harness/home"))).toBe(join(share, "yonder/home"));
	expect(() => run("--rollback")).toThrow();
	expect(() => run("--force")).toThrow();
});
