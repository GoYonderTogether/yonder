import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Finding the DeepSeek Harness launcher and the profile it will boot. The installer never
 * guesses: a missing launcher or profile is reported with the real reason (spec 23 §6).
 */

export interface DshInstall {
	/** Absolute path of the `dsh` launcher. */
	launcher: string;
	/** `$DSH_HOME` the launcher uses (explicit env var, else `~/.dsh`). */
	home: string;
	/** Profile names present under `<home>/profiles`. */
	profiles: string[];
	/** Version DSH reports, when it can be read. */
	version?: string;
}

export interface DetectOptions {
	env?: NodeJS.ProcessEnv;
	home?: string;
	exists?: (path: string) => boolean;
	readdir?: (path: string) => string[];
	/** Injectable for tests: resolve `dsh --version`. */
	version?: (launcher: string, env: NodeJS.ProcessEnv) => string | undefined;
}

const LAUNCHER_NAMES = process.platform === "win32" ? ["dsh.cmd", "dsh.exe", "dsh"] : ["dsh"];

/** Locate `dsh` on PATH and enumerate the profiles under its home. */
export function detectDsh(options: DetectOptions = {}): DshInstall {
	const env = options.env ?? process.env;
	const home = options.home ?? env.HOME ?? "";
	const exists = options.exists ?? existsSync;
	const readdir = options.readdir ?? ((path: string) => readdirSync(path));
	const launcher = findLauncher(env, exists);
	if (!launcher) {
		throw new Error(
			"找不到 dsh 命令。请先安装 DeepSeek Harness（https://deepseek.com/harness），或在 PATH 中提供 dsh。",
		);
	}
	const configured = env.DSH_HOME?.trim();
	const dshHome = configured ? configured : join(home, ".dsh");
	const profileDir = join(dshHome, "profiles");
	const profiles = exists(profileDir)
		? readdir(profileDir).filter((name) => {
				const dir = join(profileDir, name);
				return exists(join(dir, "package.json")) || exists(join(dir, "cordis.yml"));
			})
		: [];
	const version = (options.version ?? readVersion)(launcher, env);
	return { launcher, home: dshHome, profiles: profiles.sort(), ...(version ? { version } : {}) };
}

function findLauncher(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string | undefined {
	const path = env.PATH ?? "";
	for (const directory of path.split(delimiter)) {
		if (!directory) continue;
		for (const name of LAUNCHER_NAMES) {
			const candidate = join(directory, name);
			if (exists(candidate)) return candidate;
		}
	}
	return undefined;
}

function readVersion(launcher: string, env: NodeJS.ProcessEnv): string | undefined {
	try {
		const run = spawnSync(launcher, ["--version"], { encoding: "utf8", timeout: 20_000, env });
		if (run.status !== 0) return undefined;
		const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
		return match?.[1];
	} catch {
		return undefined;
	}
}

export interface InstallOptions {
	launcher: string;
	profile: string;
	/** Package spec to install: a registry name or an absolute tarball/checkout path. */
	spec: string;
	env?: NodeJS.ProcessEnv;
	/** Injectable for tests. */
	run?: (
		command: string,
		args: string[],
		env: NodeJS.ProcessEnv,
	) => { status: number | null; stdout: string; stderr: string };
}

function runCommand(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
	const run = spawnSync(command, args, { encoding: "utf8", timeout: 300_000, env });
	return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** `dsh plugin --profile <p> add <spec>`: pnpm inside the profile plus the bundle list entry. */
export function installBundle(options: InstallOptions): void {
	const env = options.env ?? process.env;
	const run = options.run ?? runCommand;
	const result = run(options.launcher, ["plugin", "--profile", options.profile, "add", options.spec], env);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim().split("\n").slice(-6).join("\n");
		throw new Error(`安装连接器失败：${detail || `dsh 退出码 ${result.status}`}`);
	}
}

/** `dsh plugin --profile <p> remove @yonder/dsh-connector`. */
export function removeBundle(options: Omit<InstallOptions, "spec"> & { name: string }): void {
	const env = options.env ?? process.env;
	const run = options.run ?? runCommand;
	const result = run(options.launcher, ["plugin", "--profile", options.profile, "remove", options.name], env);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim().split("\n").slice(-6).join("\n");
		throw new Error(`卸载连接器失败：${detail || `dsh 退出码 ${result.status}`}`);
	}
}

/** Read a profile manifest; used to confirm the bundle list actually lists the connector. */
export function profileBundles(dshHome: string, profile: string): string[] {
	const path = join(dshHome, "profiles", profile, "package.json");
	if (!existsSync(path)) return [];
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		const profileRow = (parsed as { dsh?: { profile?: { bundles?: unknown } } })?.dsh?.profile;
		const bundles = profileRow?.bundles;
		return Array.isArray(bundles) ? bundles.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Which profile to install into. An explicit `--profile` wins; otherwise the only existing
 * profile, or the one the caller is running under. Ambiguity asks rather than guessing.
 */
export function chooseProfile(profiles: string[], explicit?: string): string {
	if (explicit) {
		if (!profiles.includes(explicit))
			throw new Error(`profile「${explicit}」不存在。已安装的 profile：${profiles.join("、") || "（无）"}`);
		return explicit;
	}
	if (profiles.includes("desktop")) {
		// The Electron application owns its own profile; a third-party install there is refused by dsh.
		const others = profiles.filter((name) => name !== "desktop");
		if (!others.length)
			throw new Error(
				"只找到 desktop profile，它由 DeepSeek Harness 桌面应用独占，不能用 dsh plugin 安装。请先用 dsh web 创建一个 profile。",
			);
	}
	const usable = profiles.filter((name) => name !== "desktop");
	const [only] = usable;
	if (only && usable.length === 1) return only;
	if (!usable.length) throw new Error("没有可用的 DSH profile。先运行一次 `dsh web` 创建它，再执行本命令。");
	throw new Error(`发现多个 profile：${usable.join("、")}。请用 --profile 指定要安装到哪一个。`);
}
