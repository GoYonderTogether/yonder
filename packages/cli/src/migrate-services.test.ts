import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { applyMigration, planMigration } from "./migrate.js";

const roots: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test.each(["darwin", "linux"] as const)(
	"%s user services are planned, migrated, and not repeated",
	async (platform) => {
		const home = await mkdtemp(join(tmpdir(), "yonder-service-migrate-"));
		roots.push(home);
		vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
		const dir = platform === "darwin" ? join(home, "Library/LaunchAgents") : join(home, ".config/systemd/user");
		await mkdir(dir, { recursive: true });
		const old = join(dir, `dev.yonder.harness.service${platform === "darwin" ? ".plist" : ""}`);
		await writeFile(old, "old service");
		const options = {
			oldHome: join(home, "old-home"),
			newHome: join(home, "new-home"),
			oldInstall: join(home, ".yonder-harness"),
			newInstall: join(home, ".local/share/yonder/install"),
			platform,
		};
		const commands: string[][] = [];
		const run = async (argv: string[]) => {
			commands.push(argv);
			if (argv[0] === "rm") await rm(argv[2] as string);
			if (argv[0] === "mv") await rename(argv[1] as string, argv[2] as string);
		};
		const plan = await planMigration(options);
		expect(plan.status).toBe("ready");
		expect(await readFile(old, "utf8")).toBe("old service");
		expect(commands).toEqual([]);
		const result = await applyMigration({ ...options, run });
		expect(result.launchdErrors).toEqual([]);
		expect(commands).toEqual(plan.commands);
		expect(commands.some((argv) => argv.includes("install") && argv.includes(options.newHome))).toBe(true);
		expect((await planMigration(options)).status).toBe("noop");
	},
);

test("failed service installation retains old unit for retry", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-service-migrate-"));
	roots.push(home);
	const dir = join(home, "Library/LaunchAgents");
	await mkdir(dir, { recursive: true });
	const old = join(dir, "dev.yonder.harness.plist");
	await writeFile(old, "old service");
	const options = {
		oldHome: join(home, "old-home"),
		newHome: join(home, "new-home"),
		oldInstall: join(home, ".yonder-harness"),
		newInstall: join(home, "install"),
		platform: "darwin" as const,
		run: async (argv: string[]) => {
			if (argv[0] === "mv") await rename(argv[1] as string, argv[2] as string);
			if (argv[0] === "env") throw new Error("install failed");
		},
	};
	const result = await applyMigration(options);
	expect(result.launchdErrors).toHaveLength(1);
	expect(await readFile(`${old}.migrate`, "utf8")).toBe("old service");
	await writeFile(join(dir, "dev.yonder.service.plist"), "partially installed");
	expect((await planMigration(options)).status).toBe("ready");
	const retry = await applyMigration({
		...options,
		run: async (argv) => {
			if (argv[0] === "rm") await rm(argv[2] as string);
		},
	});
	expect(retry.launchdErrors).toEqual([]);
	expect((await planMigration(options)).status).toBe("noop");
});

test("existing new service definitions block migration without being overwritten", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-service-migrate-"));
	roots.push(home);
	const dir = join(home, "Library/LaunchAgents");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "dev.yonder.harness.status.plist"), "old status");
	const target = join(dir, "dev.yonder.status.plist");
	await writeFile(target, "existing status");
	const options = {
		oldHome: join(home, "old"),
		newHome: join(home, "new"),
		oldInstall: join(home, ".yonder-harness"),
		newInstall: join(home, "install"),
		platform: "darwin" as const,
	};
	expect((await planMigration(options)).status).toBe("blocked");
	await expect(applyMigration(options)).rejects.toThrow("新服务定义已存在");
	expect(await readFile(target, "utf8")).toBe("existing status");
});
