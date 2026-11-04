import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Finding the OpenClaw launcher and its state directory. The installer never
 * guesses: a missing launcher is reported with the real reason (spec 23 §6).
 */

export interface OpenclawInstall {
	/** Absolute path of the `openclaw` launcher. */
	launcher: string;
	/** `~/.openclaw` (or `$OPENCLAW_STATE_DIR`), OpenClaw's state root. */
	stateDir: string;
	/** Version OpenClaw reports, when it can be read. */
	version?: string;
}

export interface DetectOptions {
	env?: NodeJS.ProcessEnv;
	home?: string;
	exists?: (path: string) => boolean;
	/** Injectable for tests: resolve `openclaw --version`. */
	version?: (launcher: string, env: NodeJS.ProcessEnv) => string | undefined;
}

const LAUNCHER_NAMES = process.platform === "win32" ? ["openclaw.cmd", "openclaw.exe", "openclaw"] : ["openclaw"];

/** Locate `openclaw` on PATH and resolve the state root it uses. */
export function detectOpenclaw(options: DetectOptions = {}): OpenclawInstall {
	const env = options.env ?? process.env;
	const home = options.home ?? env.HOME ?? homedir();
	const exists = options.exists ?? existsSync;
	const launcher = findLauncher(env, exists);
	if (!launcher) {
		throw new Error("找不到 openclaw 命令。请先安装 OpenClaw（https://openclaw.ai），或在 PATH 中提供 openclaw。");
	}
	const configured = env.OPENCLAW_STATE_DIR?.trim();
	const stateDir = configured ? configured : join(home, ".openclaw");
	const version = (options.version ?? readVersion)(launcher, env);
	return { launcher, stateDir, ...(version ? { version } : {}) };
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
		const match = /(\d{4}\.\d+\.\d+|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(
			`${run.stdout ?? ""}\n${run.stderr ?? ""}`,
		);
		return match?.[1];
	} catch {
		return undefined;
	}
}

export interface PluginOptions {
	launcher: string;
	/** Package spec: `clawhub:<id>`, an npm name, `npm-pack:<tgz>`, or a local path. */
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

/**
 * `openclaw plugins install <spec> --force --accept-capabilities`: the
 * non-interactive form (unreviewed sources require --accept-capabilities;
 * --force confirms the non-ClawHub source, so no wizard prompts).
 */
export function installPlugin(options: PluginOptions): void {
	const env = options.env ?? process.env;
	const result = (options.run ?? runCommand)(
		options.launcher,
		["plugins", "install", options.spec, "--force", "--accept-capabilities"],
		env,
	);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim().split("\n").slice(-6).join("\n");
		throw new Error(`安装连接器失败：${detail || `openclaw 退出码 ${result.status}`}`);
	}
}

/** `openclaw plugins uninstall <id> --force` (leaves one `enabled:false` entry). */
export function uninstallPlugin(options: Omit<PluginOptions, "spec">): void {
	const env = options.env ?? process.env;
	const result = (options.run ?? runCommand)(
		options.launcher,
		["plugins", "uninstall", "yonder-connector", "--force"],
		env,
	);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim().split("\n").slice(-6).join("\n");
		throw new Error(`卸载连接器失败：${detail || `openclaw 退出码 ${result.status}`}`);
	}
}

/** Read the connector's enabled entry from openclaw.json (used by tests). */
export function pluginEntry(stateDir: string): { enabled?: boolean } | undefined {
	const path = join(stateDir, "openclaw.json");
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		const entries = (parsed as { plugins?: { entries?: Record<string, unknown> } })?.plugins?.entries;
		const entry = entries?.["yonder-connector"];
		return entry && typeof entry === "object" ? (entry as { enabled?: boolean }) : undefined;
	} catch {
		return undefined;
	}
}
