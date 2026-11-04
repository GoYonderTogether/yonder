import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Finding the Hermes Agent launcher and its home. The installer never guesses:
 * a missing launcher is reported with the real reason (spec 23 §6).
 */

export interface HermesInstall {
	/** Absolute path of the `hermes` launcher. */
	launcher: string;
	/** `$HERMES_HOME` the launcher uses (explicit env var, else `~/.hermes`). */
	home: string;
	/** Version Hermes reports, when it can be read. */
	version?: string;
}

export interface DetectOptions {
	env?: NodeJS.ProcessEnv;
	home?: string;
	exists?: (path: string) => boolean;
	/** Injectable for tests: resolve `hermes --version`. */
	version?: (launcher: string, env: NodeJS.ProcessEnv) => string | undefined;
}

const LAUNCHER_NAMES = process.platform === "win32" ? ["hermes.cmd", "hermes.exe", "hermes"] : ["hermes"];

/** Locate `hermes` on PATH and resolve the home its launcher uses. */
export function detectHermes(options: DetectOptions = {}): HermesInstall {
	const env = options.env ?? process.env;
	const home = options.home ?? env.HOME ?? homedir();
	const exists = options.exists ?? existsSync;
	const launcher = findLauncher(env, exists);
	if (!launcher) {
		throw new Error(
			"找不到 hermes 命令。请先安装 Hermes Agent（https://github.com/NousResearch/hermes-agent），或在 PATH 中提供 hermes。",
		);
	}
	const configured = env.HERMES_HOME?.trim();
	const hermesHome = configured ? configured : join(home, ".hermes");
	const version = (options.version ?? readVersion)(launcher, env);
	return { launcher, home: hermesHome, ...(version ? { version } : {}) };
}

function findLauncher(env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string | undefined {
	const path = env.PATH ?? "";
	for (const directory of path.split(process.platform === "win32" ? ";" : ":")) {
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
		const match = /v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(`${run.stdout ?? ""}\n${run.stderr ?? ""}`);
		return match?.[1];
	} catch {
		return undefined;
	}
}

export interface InstallOptions {
	launcher: string;
	/** Plugin source: a local directory (drop-in) or a git source hermes accepts. */
	source: string;
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

/**
 * Hermes installs plugins as drop-in directories (`~/.hermes/plugins/<name>/`,
 * the documented path) plus an entry in `plugins.enabled` in config.yaml;
 * `hermes plugins install <path>` treats the argument as a git source, so the
 * installer copies the directory itself and enables it through the CLI.
 */
function runChecked(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	run: InstallOptions["run"],
	label: string,
): void {
	const result = (run ?? runCommand)(command, args, env);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim().split("\n").slice(-6).join("\n");
		throw new Error(`${label}失败：${detail || `hermes 退出码 ${result.status}`}`);
	}
}

/** `hermes plugins enable yonder-connector` after the drop-in copy exists. */
export function enablePlugin(launcher: string, env: NodeJS.ProcessEnv, run: InstallOptions["run"]): void {
	runChecked(launcher, ["plugins", "enable", "yonder-connector"], env, run, "启用连接器");
}

/** `hermes plugins remove yonder-connector` before the drop-in copy is deleted. */
export function removePlugin(launcher: string, env: NodeJS.ProcessEnv, run: InstallOptions["run"]): void {
	runChecked(launcher, ["plugins", "remove", "yonder-connector"], env, run, "卸载连接器");
}

/** The user plugin directory Hermes discovers: `<HERMES_HOME>/plugins`. */
export function pluginsDir(hermesHome: string): string {
	return join(hermesHome, "plugins");
}

/** Copy the plugin directory into Hermes's user plugin dir (documented drop-in). */
export function copyPlugin(hermesHome: string, source: string): string {
	const target = join(pluginsDir(hermesHome), "yonder-connector");
	if (!existsSync(join(source, "plugin.yaml"))) {
		throw new Error(`连接器源目录缺少 plugin.yaml：${source}`);
	}
	mkdirSync(pluginsDir(hermesHome), { recursive: true, mode: 0o700 });
	if (existsSync(target)) {
		throw new Error(`连接器目录已存在：${target}（先 --remove 再重装）`);
	}
	copyTree(source, target);
	return target;
}

/** Remove the drop-in copy; returns what was removed. */
export function removePluginDir(hermesHome: string): string | undefined {
	const target = join(pluginsDir(hermesHome), "yonder-connector");
	if (!existsSync(target)) return undefined;
	rmTree(target);
	return target;
}

function copyTree(source: string, target: string): void {
	mkdirSync(target, { recursive: true });
	for (const entry of readdirSafe(source)) {
		const from = join(source, entry);
		const to = join(target, entry);
		if (statIsDirectory(from)) copyTree(from, to);
		else {
			writeFileSync(to, readFileSync(from));
			chmodSync(to, 0o600);
		}
	}
}

function rmTree(path: string): void {
	for (const entry of readdirSafe(path)) {
		const child = join(path, entry);
		if (statIsDirectory(child)) rmTree(child);
		else unlinkSync(child);
	}
	try {
		unlinkSync(path);
	} catch (error) {
		// A non-empty directory (unexpected files): rmdir via rename fallback.
		try {
			renameSync(path, `${path}.removed-${process.pid}`);
		} catch {
			throw error;
		}
	}
}

function readdirSafe(path: string): string[] {
	try {
		return readdirSync(path);
	} catch {
		return [];
	}
}

function statIsDirectory(path: string): boolean {
	try {
		return (statSync(path) as { isDirectory(): boolean }).isDirectory();
	} catch {
		return false;
	}
}
