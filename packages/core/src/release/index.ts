import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
	access,
	chmod,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, posix, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { controlEndpoint, requestControl } from "../control/index.js";
import { canonicalRepository } from "./repository.js";
import { recordUpdateResult, type UpdateResult } from "./result.js";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const label = "dev.yonder.harness";
const statusLabel = "dev.yonder.harness.status";
const statusPlistPath = () => join(homedir(), "Library/LaunchAgents", `${statusLabel}.plist`);
const statusExecutable = (install: string) =>
	join(install, "current/packages/macos/dist/YonderStatus.app/Contents/MacOS/YonderStatus");
const plistPath = () => join(homedir(), "Library/LaunchAgents", `${label}.plist`);
const windowsData = () => resolve(process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "YonderHarness");
const installPath = () =>
	resolve(
		process.env.YONDER_INSTALL ?? (process.platform === "win32" ? windowsData() : join(homedir(), ".yonder-harness")),
	);
const linuxUnitPath = () =>
	join(resolve(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")), "systemd/user", `${label}.service`);
const windowsServicePath = () => join(windowsData(), "service.json");
const windowsTask = "Yonder Harness";
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const xml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
const domain = () => `gui/${process.getuid?.()}`;
const versionPattern = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

/** Semver ordering: a pre-release (for example `-beta.1`) sorts before the same X.Y.Z without one. */
export function compareVersions(a: string, b: string): number {
	const left = versionPattern.exec(a),
		right = versionPattern.exec(b);
	if (!left || !right) throw new Error("Version must be X.Y.Z[-prerelease] or vX.Y.Z[-prerelease]");
	for (let index = 1; index <= 3; index++) {
		const delta = BigInt(left[index] ?? "0") - BigInt(right[index] ?? "0");
		if (delta) return delta < 0n ? -1 : 1;
	}
	const l = left[4]?.split("."),
		r = right[4]?.split(".");
	if (!l || !r) return l ? -1 : r ? 1 : 0;
	for (let index = 0; index < Math.max(l.length, r.length); index++) {
		const x = l[index],
			y = r[index];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		const numeric = /^\d+$/u;
		if (numeric.test(x) && numeric.test(y)) {
			const delta = BigInt(x) - BigInt(y);
			if (delta) return delta < 0n ? -1 : 1;
		} else if (numeric.test(x) !== numeric.test(y)) return numeric.test(x) ? -1 : 1;
		else if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}
function normalizeVersion(version: string): string {
	if (!versionPattern.test(version)) throw new Error(`Invalid release version: ${version}`);
	return version.replace(/^v/u, "");
}
/** Highest release tag. Stable by default; pass `prerelease` to include test builds such as `v0.2.26102002`. */
export function latestRelease(tags: string[], prerelease = false): string {
	const versions = tags.filter(
		(tag) => tag.startsWith("v") && versionPattern.test(tag) && (prerelease || !tag.includes("-")),
	);
	versions.sort(compareVersions);
	const tag = versions.at(-1);
	if (!tag) throw new Error("The repository has no vX.Y.Z release tags");
	return tag;
}
async function manifest(root = sourceRoot): Promise<{ version: string; repository?: string | { url?: string } }> {
	return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
}
export async function releaseInfo(home?: string) {
	const originFile = join(sourceRoot, ".yonder-install.json");
	return {
		version: (await manifest(join(sourceRoot, "packages/cli"))).version,
		install: installPath(),
		source: sourceRoot,
		home: home ?? null,
		origin: existsSync(originFile) ? JSON.parse(await readFile(originFile, "utf8")) : null,
	};
}
export async function checkRelease() {
	const root = await manifest();
	const repository = typeof root.repository === "string" ? root.repository : root.repository?.url;
	if (!repository) throw new Error("Repository is not configured");
	const url = new URL(repository);
	const match = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
	if (url.hostname !== "github.com" || !match)
		throw new Error("Update checks require the configured GitHub repository");
	const release = JSON.parse(
		(await command("gh", ["api", `repos/${match[1]}/${match[2]}/releases/latest`])).stdout,
	) as { tag_name: string; html_url: string; draft: boolean; prerelease: boolean };
	if (release.draft || release.prerelease) throw new Error("Latest release is not a formal release");
	const latest = normalizeVersion(release.tag_name),
		current = (await manifest(join(sourceRoot, "packages/cli"))).version;
	return { current, latest, updateAvailable: compareVersions(latest, current) > 0, url: release.html_url };
}
export async function readDocs(path?: string, list = false): Promise<string | string[]> {
	const root = await realpath(join(sourceRoot, "docs"));
	if (list) {
		const files: string[] = [];
		const walk = async (directory: string) => {
			for (const entry of await readdir(directory, { withFileTypes: true })) {
				const child = join(directory, entry.name);
				if (entry.isDirectory()) await walk(child);
				else if (entry.isFile()) files.push(relative(root, child));
			}
		};
		const directory = path ? await realpath(resolve(root, path)) : root;
		const inside = relative(root, directory);
		if (isAbsolute(inside) || inside === ".." || inside.startsWith("../") || inside.startsWith("..\\"))
			throw new Error("Document path must stay inside docs/");
		await walk(directory);
		return files.sort();
	}
	const target = await realpath(resolve(root, path ?? "index.md")),
		inside = relative(root, target);
	if (isAbsolute(inside) || inside === ".." || inside.startsWith("../") || inside.startsWith("..\\"))
		throw new Error("Document path must stay inside docs/");
	return readFile(target, "utf8");
}
export function selectChangelog(text: string, from: string | undefined, to: string): string {
	const upper = normalizeVersion(to),
		lower = from === undefined ? undefined : normalizeVersion(from);
	const headings = [...text.matchAll(/^## \[([^\]]+)\][^\n]*$/gmu)];
	const releases = headings.flatMap((match, index) => {
		const version = match[1];
		if (!version || !versionPattern.test(version)) return [];
		return [
			{
				version: normalizeVersion(version),
				text: text.slice(match.index, headings[index + 1]?.index ?? text.length).trimEnd(),
			},
		];
	});
	const previous =
		lower ??
		releases
			.map((item) => item.version)
			.filter((version) => compareVersions(version, upper) < 0)
			.sort(compareVersions)
			.at(-1);
	return releases
		.filter(
			(item) =>
				compareVersions(item.version, upper) <= 0 &&
				(previous === undefined || compareVersions(item.version, previous) > 0),
		)
		.map((item) => item.text)
		.join("\n\n");
}
export async function readChangelog(from?: string, to?: string): Promise<string> {
	return selectChangelog(
		await readFile(join(sourceRoot, "CHANGELOG.md"), "utf8"),
		from,
		to ?? (await manifest(join(sourceRoot, "packages/cli"))).version,
	);
}
interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}
function command(
	program: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {},
): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			const result = { code: code ?? 1, stdout, stderr };
			if (result.code && !options.allowFailure)
				reject(new Error(`${program} failed (${result.code}): ${stderr.trim() || stdout.trim()}`));
			else resolve(result);
		});
	});
}
function npmCommand(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
	return process.platform === "win32"
		? command("cmd.exe", ["/d", "/s", "/c", "npm", ...args], options)
		: command("npm", args, options);
}
export async function unloadService(service: string): Promise<void> {
	const before = await command("launchctl", ["print", service], { allowFailure: true });
	if (before.code !== 0) return;
	const pid = Number(/^\s*pid = (\d+)$/mu.exec(before.stdout)?.[1]);
	await command("launchctl", ["bootout", service]);
	const deadline = Date.now() + 30_000;
	while (true) {
		let alive = false;
		if (pid) {
			try {
				process.kill(pid, 0);
				alive = true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		}
		const registered = (await command("launchctl", ["print", service], { allowFailure: true })).code === 0;
		if (!alive && !registered) return;
		if (Date.now() >= deadline) throw new Error(`launchd service has not finished stopping: ${service}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}
interface ServiceInstallation {
	home: string;
	install: string;
	plist: string;
}
export async function installedService(): Promise<ServiceInstallation | undefined> {
	if (process.platform === "linux") {
		if (!existsSync(linuxUnitPath())) return;
		const unit = await readFile(linuxUnitPath(), "utf8");
		const record = /^# YonderService=(.+)$/mu.exec(unit)?.[1];
		if (!record) throw new Error("Installed systemd unit is missing its Yonder service record");
		const { home, install } = JSON.parse(record) as { home?: string; install?: string };
		if (!home || !install) throw new Error("Installed systemd unit is missing its home or install");
		return { home, install, plist: linuxUnitPath() };
	}
	if (process.platform === "win32") {
		if (!existsSync(windowsServicePath())) return;
		const { home, install } = JSON.parse(await readFile(windowsServicePath(), "utf8")) as {
			home?: string;
			install?: string;
		};
		if (!home || !install) throw new Error("Installed Windows task is missing its home or install");
		return { home, install, plist: windowsServicePath() };
	}
	if (process.platform !== "darwin" || !existsSync(plistPath())) return;
	const result = await command("plutil", ["-convert", "json", "-o", "-", plistPath()]);
	const plist = JSON.parse(result.stdout) as {
		ProgramArguments?: string[];
		EnvironmentVariables?: Record<string, string>;
	};
	const args = plist.ProgramArguments ?? [],
		home = args[args.indexOf("--home") + 1];
	if (!args.includes("--home") || !home || !args[0])
		throw new Error("Installed service plist is missing its home or executable");
	return { home, install: plist.EnvironmentVariables?.YONDER_INSTALL ?? dirname(dirname(args[0])), plist: plistPath() };
}
function runtimePath(install: string): string {
	return [...new Set([join(install, "bin"), dirname(process.execPath), ...(process.env.PATH ?? "").split(delimiter)])]
		.filter(Boolean)
		.join(delimiter);
}

function windowsBatchValue(value: string): string {
	if (/[\r\n"]/u.test(value)) throw new Error("Windows install paths must not contain quotes or line breaks");
	return value.replaceAll("%", "%%").replaceAll("^", "^^");
}
export function windowsLauncher(install: string, node = process.execPath, path = runtimePath(install)): string {
	return `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "PATH=${windowsBatchValue(path)}"\r\nset "YONDER_INSTALL=${windowsBatchValue(install)}"\r\n"${windowsBatchValue(node)}" "${windowsBatchValue(win32.join(install, "current/packages/cli/dist/index.js"))}" %*\r\n`;
}
export function windowsServiceLauncher(
	install: string,
	home: string,
	node = process.execPath,
	path = runtimePath(install),
): string {
	return `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "PATH=${windowsBatchValue(path)}"\r\nset "YONDER_INSTALL=${windowsBatchValue(install)}"\r\n"${windowsBatchValue(node)}" "${windowsBatchValue(win32.join(install, "current/packages/cli/dist/index.js"))}" start --home "${windowsBatchValue(home)}" --json >> "${windowsBatchValue(win32.join(home, ".yonder/logs/harness.log"))}" 2>&1\r\n`;
}
export function launcher(install: string, node = process.execPath, path = runtimePath(install)): string {
	return `#!/bin/sh\nPATH=${shellQuote(path)}\nYONDER_INSTALL=${shellQuote(install)}\nexport PATH YONDER_INSTALL\nexec ${shellQuote(node)} ${shellQuote(join(install, "current/packages/cli/dist/index.js"))} "$@"\n`;
}
export function serviceLauncher(install: string, node = process.execPath, path = runtimePath(install)): string {
	return `#!/bin/sh\nPATH=${shellQuote(path)}\nYONDER_INSTALL=${shellQuote(install)}\nexport PATH YONDER_INSTALL\nexec ${shellQuote(node)} ${shellQuote(join(install, "current/scripts/yonder-service-host.mjs"))} "$@"\n`;
}
export function servicePlist(install: string, home: string, path = runtimePath(install), hosted = true): string {
	const pair = (key: string, value: string) => `<key>${key}</key><string>${xml(value)}</string>`;
	return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${pair("Label", label)}
<key>ProgramArguments</key><array>${(hosted ? [join(install, "bin/yonder-service"), "--home", home] : [join(install, "bin/yonder"), "start", "--home", home, "--json"]).map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
${pair("StandardOutPath", join(home, ".yonder/logs/harness.log"))}
${pair("StandardErrorPath", join(home, ".yonder/logs/harness.log"))}
<key>EnvironmentVariables</key><dict>${pair("PATH", path)}${pair("YONDER_INSTALL", install)}${pair("YONDER_HOME", home)}</dict>
</dict></plist>\n`;
}
export function statusPlist(install: string, home: string): string {
	const pair = (key: string, value: string) => `<key>${key}</key><string>${xml(value)}</string>`;
	return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
${pair("Label", statusLabel)}<key>ProgramArguments</key><array><string>${xml(statusExecutable(install))}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
${pair("StandardOutPath", join(home, ".yonder/logs/status.log"))}${pair("StandardErrorPath", join(home, ".yonder/logs/status.log"))}
<key>EnvironmentVariables</key><dict>${pair("PATH", runtimePath(install))}${pair("YONDER_INSTALL", install)}${pair("YONDER_HOME", home)}</dict>
</dict></plist>\n`;
}
function systemdEscape(value: string): string {
	if (/[\r\n]/u.test(value)) throw new Error("systemd service paths must not contain line breaks");
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
}
const systemdExecArg = (value: string) => `"${systemdEscape(value).replaceAll("$", () => "$$")}"`;
const systemdEnvironment = (value: string) => `"${systemdEscape(value)}"`;
export function linuxServiceUnit(install: string, home: string, path = runtimePath(install)): string {
	return `# YonderService=${JSON.stringify({ home, install })}\n[Unit]\nDescription=Yonder Harness\n[Service]\nType=simple\nExecStart=${systemdExecArg(posix.join(install, "bin/yonder"))} start --home ${systemdExecArg(home)} --json\nEnvironment=${systemdEnvironment(`PATH=${path}`)}\nEnvironment=${systemdEnvironment(`YONDER_INSTALL=${install}`)}\nEnvironment=${systemdEnvironment(`YONDER_HOME=${home}`)}\nRestart=on-failure\nRestartSec=2\n[Install]\nWantedBy=default.target\n`;
}

async function manageLinuxService(action: ServiceAction, options: { home?: string }) {
	let installed = await installedService();
	const unit = `${label}.service`;
	const systemctl = (args: string[], allowFailure = false) =>
		command("systemctl", ["--user", ...args], { allowFailure });
	if (action === "install") {
		if (!options.home) throw new Error("service install requires --home");
		const home = resolve(options.home),
			install = installPath();
		await access(join(home, "yonder.yaml"));
		await access(join(install, "bin/yonder"));
		await mkdir(dirname(linuxUnitPath()), { recursive: true });
		await writeFile(linuxUnitPath(), linuxServiceUnit(install, home), { mode: 0o600 });
		await systemctl(["daemon-reload"]);
		await systemctl(["enable", unit]);
		await systemctl(["restart", unit]);
		installed = { home, install, plist: linuxUnitPath() };
	} else if (action === "uninstall") {
		if (installed) {
			await systemctl(["disable", "--now", unit]);
			await rm(linuxUnitPath());
			await systemctl(["daemon-reload"]);
		}
		return { installed: false, loaded: false };
	} else if (action !== "status") {
		if (!installed) throw new Error("Yonder Harness service is not installed");
		await systemctl([action, unit]);
	}
	const state = await systemctl(["show", unit, "--property=ActiveState,MainPID", "--no-pager"], true);
	const active = /^ActiveState=active$/mu.test(state.stdout);
	const pid = Number(/^MainPID=(\d+)$/mu.exec(state.stdout)?.[1]) || null;
	return {
		installed: !!installed,
		loaded: active,
		...(installed ? { home: installed.home, install: installed.install, plist: installed.plist } : {}),
		state: /^ActiveState=(.+)$/mu.exec(state.stdout)?.[1] ?? "inactive",
		pid,
	};
}

async function manageWindowsService(action: ServiceAction, options: { home?: string }) {
	let installed = await installedService();
	const task = (args: string[], allowFailure = false) =>
		command("schtasks.exe", [...args, "/TN", windowsTask], { allowFailure });
	const stopTask = async (home?: string) => {
		let pid: number | undefined;
		if (home) {
			try {
				pid = ((await requestControl(home, { method: "service.info" })) as { pid?: number }).pid;
				await requestControl(home, { method: "stop" });
			} catch {
				/* A stopped or starting task has no control endpoint. */
			}
		}
		if (pid) {
			const alive = () => {
				try {
					process.kill(pid, 0);
					return true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
					throw error;
				}
			};
			const grace = Date.now() + 5_000;
			while (alive() && Date.now() < grace) await new Promise((resolve) => setTimeout(resolve, 100));
			if (!alive()) return;
			await task(["/End"], true);
			const deadline = Date.now() + 30_000;
			while (alive()) {
				if (Date.now() >= deadline) throw new Error(`Windows task process has not finished stopping: ${pid}`);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		} else await task(["/End"], true);
	};
	if (action === "install") {
		if (!options.home) throw new Error("service install requires --home");
		const home = resolve(options.home),
			install = installPath();
		await access(join(home, "yonder.yaml"));
		await access(join(install, "bin/yonder.cmd"));
		await mkdir(join(home, ".yonder/logs"), { recursive: true });
		const script = join(install, "bin/yonder-service.cmd");
		const previous = await task(["/Query"], true);
		if (previous.code === 0) await stopTask(installed?.home);
		if (/[%\r\n"]/u.test(script))
			throw new Error("Windows task script path must not contain percent, quotes or line breaks");
		await writeFile(script, windowsServiceLauncher(install, home));
		const commandLine = `cmd.exe /d /c ""${script}""`;
		if (commandLine.length > 262) throw new Error("Windows scheduled task command exceeds the 262-character /TR limit");
		await task(["/Create", "/SC", "ONLOGON", "/TR", commandLine, "/F", "/RL", "LIMITED"]);
		await mkdir(dirname(windowsServicePath()), { recursive: true });
		await writeFile(windowsServicePath(), JSON.stringify({ home, install }), { mode: 0o600 });
		await task(["/Run"]);
		installed = { home, install, plist: windowsServicePath() };
	} else if (action === "uninstall") {
		if ((await task(["/Query"], true)).code === 0) {
			await stopTask(installed?.home);
			await task(["/Delete", "/F"]);
		}
		await rm(windowsServicePath(), { force: true });
		return { installed: false, loaded: false };
	} else if (action !== "status") {
		if (!installed) throw new Error("Yonder Harness service is not installed");
		if (action === "stop" || action === "restart") await stopTask(installed.home);
		let running = false;
		if (action === "start") {
			try {
				running = !!((await requestControl(installed.home, { method: "service.info" })) as { pid?: number }).pid;
			} catch {
				/* The task is not ready. */
			}
		}
		if ((action === "start" && !running) || action === "restart") await task(["/Run"]);
	}
	const registered = (await task(["/Query"], true)).code === 0;
	let info: { pid?: number } | undefined;
	if (registered && installed) {
		try {
			info = (await requestControl(installed.home, { method: "service.info" })) as { pid?: number };
		} catch {
			/* A registered task may be stopped or still starting. */
		}
	}
	return {
		installed: registered && !!installed,
		loaded: !!info?.pid,
		...(registered && installed ? { home: installed.home, install: installed.install, plist: installed.plist } : {}),
		state: info?.pid ? "running" : "stopped",
		pid: info?.pid ?? null,
	};
}

export type ServiceAction = "install" | "uninstall" | "start" | "stop" | "restart" | "status";
interface ServiceStatus {
	installed: boolean;
	loaded: boolean;
	home?: string;
	install?: string;
	plist?: string;
	state?: string;
	pid?: number | null;
	launcherPid?: number | null;
}
export async function manageService(action: ServiceAction, options: { home?: string } = {}): Promise<ServiceStatus> {
	if (process.platform === "linux") return manageLinuxService(action, options);
	if (process.platform === "win32") return manageWindowsService(action, options);
	if (process.platform !== "darwin")
		throw new Error("Yonder Harness background services currently support macOS launchd only");
	let installed = await installedService();
	const service = `${domain()}/${label}`;
	const loaded = async () => (await command("launchctl", ["print", service], { allowFailure: true })).code === 0;
	if (action === "install") {
		if (!options.home) throw new Error("service install requires --home");
		const home = resolve(options.home),
			install = installPath();
		await access(join(home, "yonder.yaml"));
		await access(join(install, "bin/yonder"));
		await access(statusExecutable(install));
		await mkdir(dirname(plistPath()), { recursive: true });
		await mkdir(join(home, ".yonder/logs"), { recursive: true });
		if (await loaded()) await unloadService(service);
		// Older rollback artifacts lack the host launcher. Restore their original
		// service chain instead of pointing launchd at a script that does not exist.
		const hosted = existsSync(join(install, "current/scripts/yonder-service-host.mjs"));
		if (hosted) {
			await writeFile(join(install, "bin/yonder-service"), serviceLauncher(install), { mode: 0o755 });
			await chmod(join(install, "bin/yonder-service"), 0o755);
		}
		await writeFile(plistPath(), servicePlist(install, home, runtimePath(install), hosted), { mode: 0o600 });
		await command("launchctl", ["bootstrap", domain(), plistPath()]);
		installed = { home, install, plist: plistPath() };
		const statusService = `${domain()}/${statusLabel}`;
		if ((await command("launchctl", ["print", statusService], { allowFailure: true })).code === 0)
			await unloadService(statusService);
		await writeFile(statusPlistPath(), statusPlist(install, home), { mode: 0o600 });
		await command("launchctl", ["bootstrap", domain(), statusPlistPath()]);
	} else if (action === "status") {
		const status = await command("launchctl", ["print", service], { allowFailure: true });
		const launcherPid = Number(/^\s*pid = (\d+)$/mu.exec(status.stdout)?.[1]) || null;
		let nodePid: number | undefined;
		if (installed && launcherPid) {
			try {
				const host = JSON.parse(await readFile(join(installed.home, ".yonder/service-host.json"), "utf8")) as {
					launcherPid: number;
					nodePid: number;
					updatedAt: number;
				};
				if (host.launcherPid === launcherPid && Date.now() - host.updatedAt < 5000 && host.nodePid > 0) {
					process.kill(host.nodePid, 0);
					nodePid = host.nodePid;
				}
			} catch {
				/* No current host lease: old direct-Node services keep their PID. */
			}
		}
		return {
			installed: !!installed,
			loaded: status.code === 0,
			...(installed ? { home: installed.home, install: installed.install, plist: installed.plist } : {}),
			...(status.code === 0
				? {
						state: /^\s*state = (.+)$/mu.exec(status.stdout)?.[1] ?? "loaded",
						pid: nodePid ?? launcherPid,
						launcherPid,
					}
				: {}),
		};
	} else if (action === "uninstall") {
		if (await loaded()) await unloadService(service);
		const statusService = `${domain()}/${statusLabel}`;
		if ((await command("launchctl", ["print", statusService], { allowFailure: true })).code === 0)
			await unloadService(statusService);
		await rm(statusPlistPath(), { force: true });
		if (installed) await rm(installed.plist);
		return { installed: false, loaded: false };
	} else {
		if (!installed) throw new Error("Yonder Harness service is not installed");
		const running = await loaded();
		if (action === "stop") {
			if (running) await unloadService(service);
		} else if (running && action === "restart") {
			// Do not SIGKILL the foreground lease before Helper has reaped Node.
			await unloadService(service);
			await command("launchctl", ["bootstrap", domain(), installed.plist]);
		} else if (running) await command("launchctl", ["kickstart", service]);
		else await command("launchctl", ["bootstrap", domain(), installed.plist]);
		if (action === "start" && existsSync(statusPlistPath())) {
			const statusService = `${domain()}/${statusLabel}`;
			if ((await command("launchctl", ["print", statusService], { allowFailure: true })).code !== 0)
				await command("launchctl", ["bootstrap", domain(), statusPlistPath()]);
			else await command("launchctl", ["kickstart", statusService]);
		} else if (action === "restart") {
			const statusService = `${domain()}/${statusLabel}`;
			const state = await command("launchctl", ["print", statusService], { allowFailure: true });
			if (state.code === 0 && /^\s*pid = \d+$/mu.test(state.stdout))
				await command("launchctl", ["kickstart", "-k", statusService]);
		}
	}
	return {
		installed: true,
		loaded: action !== "stop",
		home: installed.home,
		install: installed.install,
		plist: installed.plist,
	};
}
/** Refuse to move or remove anything except a link into this install's own version directory. */
export async function managedVersionLink(install: string, link: string): Promise<string | undefined> {
	const entry = await lstat(link).catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
	if (!entry) return;
	if (!entry.isSymbolicLink()) throw new Error(`Refusing unmanaged current path: ${link}`);
	const versions = join(install, "versions");
	const versionsEntry = await lstat(versions);
	if (!versionsEntry.isDirectory() || versionsEntry.isSymbolicLink())
		throw new Error(`Refusing unmanaged versions directory: ${versions}`);
	const version = relative(await realpath(versions), await realpath(link));
	if (!versionPattern.test(version)) throw new Error(`Refusing version link outside managed versions: ${link}`);
	return version;
}
export async function unlinkManagedVersionLink(install: string, link: string): Promise<void> {
	if (await managedVersionLink(install, link)) await unlink(link);
}
async function requireMissingPath(path: string): Promise<void> {
	try {
		await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	throw new Error(`Refusing to replace an unexpected current path: ${path}`);
}
async function currentVersion(install: string): Promise<string | undefined> {
	if (process.platform === "win32") return managedVersionLink(install, join(install, "current"));
	try {
		return basename(await realpath(join(install, "current")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}
async function runningHome(home: string | undefined): Promise<boolean> {
	if (!home) return false;
	const path = controlEndpoint(home);
	if (process.platform !== "win32") {
		try {
			if (!(await stat(path)).isSocket()) return false;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}
	return new Promise((resolve) => {
		const socket = createConnection(path);
		socket.once("connect", () => {
			socket.end();
			resolve(true);
		});
		socket.once("error", () => {
			socket.destroy();
			resolve(false);
		});
	});
}
export interface UpdateOptions {
	to?: string;
	repo?: string;
	home?: string;
	onProgress?: (stage: string) => void;
}
async function installRelease(options: UpdateOptions = {}) {
	const install = installPath(),
		versions = join(install, "versions");
	const rootManifest = await manifest();
	const repository =
		options.repo ??
		(typeof rootManifest.repository === "string" ? rootManifest.repository : rootManifest.repository?.url);
	if (!repository) throw new Error("Repository is not configured; pass --repo <url>");
	let target = options.to ?? "latest";
	if (target === "latest" || target === "beta") {
		options.onProgress?.(`Resolving ${target === "beta" ? "newest test" : "latest"} release`);
		const refs = await command("git", ["ls-remote", "--tags", "--refs", repository]);
		target = latestRelease(
			refs.stdout.split("\n").flatMap((line) => {
				const tag = line.split("\t")[1]?.replace(/^refs\/tags\//u, "");
				return tag ? [tag] : [];
			}),
			target === "beta",
		);
	}
	const version = normalizeVersion(target),
		tag = `v${version}`,
		previous = await currentVersion(install);
	if (previous === version) return { updated: false, version, install };
	const directory = join(versions, version),
		temporary = join(versions, `${version}.tmp`);
	await mkdir(versions, { recursive: true });
	if (!existsSync(directory)) {
		options.onProgress?.(`Building ${tag}`);
		try {
			await command("git", ["clone", "--depth", "1", "--branch", tag, repository, temporary]);
			await npmCommand(["ci"], { cwd: temporary, env: { ...process.env, PATH: runtimePath(install) } });
			await npmCommand(["run", "build"], { cwd: temporary, env: { ...process.env, PATH: runtimePath(install) } });
			if ((await manifest(join(temporary, "packages/cli"))).version !== version)
				throw new Error(`Tag ${tag} does not match its package version`);
			const commit = (await command("git", ["rev-parse", "HEAD"], { cwd: temporary })).stdout.trim();
			let origin = repository;
			if (/^https?:\/\//u.test(repository)) {
				const url = new URL(repository);
				url.username = "";
				url.password = "";
				origin = url.href;
			}
			await writeFile(
				join(temporary, ".yonder-install.json"),
				JSON.stringify({ repository: origin, tag, commit, version }, null, 2),
			);
			await rm(join(temporary, ".git"), { recursive: true });
			await rename(temporary, directory);
		} catch (error) {
			await rm(temporary, { recursive: true, force: true });
			throw error;
		}
	}
	await access(join(directory, "packages/cli/dist/index.js"));
	const service = await installedService();
	const thisService = service && resolve(service.install) === install ? service : undefined;
	if (thisService) {
		options.onProgress?.("Checking the service home with the new release");
		await command(
			process.execPath,
			[join(directory, "packages/cli/dist/index.js"), "doctor", "--home", thisService.home, "--json"],
			{ env: { ...process.env, PATH: runtimePath(install), YONDER_INSTALL: install, YONDER_HOME: thisService.home } },
		);
	}
	await mkdir(join(install, "bin"), { recursive: true });
	const wrapper = join(install, process.platform === "win32" ? "bin/yonder.cmd" : "bin/yonder"),
		newWrapper = `${wrapper}.${randomUUID()}.tmp`;
	const link = join(install, `.current.${randomUUID()}`);
	const previousLink = join(install, `.previous.${randomUUID()}`);
	let movedPrevious = false;
	try {
		if (process.platform === "win32" && (await managedVersionLink(install, join(install, "current"))) !== previous)
			throw new Error("Current version link changed during update");
		await writeFile(newWrapper, process.platform === "win32" ? windowsLauncher(install) : launcher(install), {
			mode: 0o755,
		});
		if (process.platform !== "win32") await chmod(newWrapper, 0o755);
		await symlink(
			process.platform === "win32" ? directory : join("versions", version),
			link,
			process.platform === "win32" ? "junction" : "dir",
		);
		if (process.platform === "win32" && (await managedVersionLink(install, link)) !== version)
			throw new Error("New version junction does not target the requested release");
		await rename(newWrapper, wrapper);
		if (process.platform === "win32" && previous) {
			if ((await managedVersionLink(install, join(install, "current"))) !== previous)
				throw new Error("Current version link changed during update");
			await rename(join(install, "current"), previousLink);
			movedPrevious = true;
		}
		if (process.platform === "win32") await requireMissingPath(join(install, "current"));
		await rename(link, join(install, "current"));
		if (movedPrevious) {
			movedPrevious = false;
			await unlinkManagedVersionLink(install, previousLink);
		}
	} catch (error) {
		if (movedPrevious) {
			if ((await managedVersionLink(install, previousLink)) !== previous)
				throw new Error("Cannot roll back an unmanaged previous version link", { cause: error });
			await requireMissingPath(join(install, "current"));
			await rename(previousLink, join(install, "current"));
		}
		throw error;
	} finally {
		await rm(newWrapper, { force: true });
		if (process.platform === "win32") await unlinkManagedVersionLink(install, link);
		else await rm(link, { force: true });
	}
	let restartRequired = false;
	if (thisService) {
		options.onProgress?.("Refreshing and restarting the service");
		await manageService("install", { home: thisService.home });
	} else restartRequired = await runningHome(options.home);
	const directories = (await readdir(versions, { withFileTypes: true })).filter(
		(entry) => entry.isDirectory() && versionPattern.test(entry.name),
	);
	const recent = await Promise.all(
		directories.map(async (entry) => ({ name: entry.name, mtime: (await stat(join(versions, entry.name))).mtimeMs })),
	);
	recent.sort((a, b) => b.mtime - a.mtime);
	const keep = new Set([version, ...(previous ? [previous] : [])]);
	for (const entry of recent) if (keep.size < 3) keep.add(entry.name);
	for (const entry of recent) if (!keep.has(entry.name)) await rm(join(versions, entry.name), { recursive: true });
	return {
		updated: true,
		version,
		install,
		restartRequired,
		...(restartRequired ? { message: "The harness is still running; restart it to use the new release." } : {}),
		path: join(install, "bin"),
	};
}

/** One update at a time per install: a second caller fails fast instead of racing in the same temp directory. */
async function acquireUpdateLock(install: string): Promise<() => Promise<void>> {
	await mkdir(install, { recursive: true });
	const file = join(install, ".update.lock");
	for (let attempt = 0; ; attempt++) {
		try {
			await writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx", mode: 0o600 });
			return async () => {
				await rm(file, { force: true });
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let holder: { pid?: number; at?: number } = {};
			try {
				holder = JSON.parse(await readFile(file, "utf8"));
			} catch {}
			let alive = false;
			if (typeof holder.pid === "number") {
				try {
					process.kill(holder.pid, 0);
					alive = true;
				} catch {}
			}
			if (alive && Date.now() - (holder.at ?? 0) < 30 * 60_000)
				throw new Error(
					`Another update is already running (pid ${holder.pid}); wait for its result instead of starting a second one.`,
				);
			if (attempt > 0) throw new Error("Could not take the update lock");
			await rm(file, { force: true });
		}
	}
}

/** Shared by direct CLI updates and the existing service-external update job. */
export async function updateRelease(options: UpdateOptions = {}) {
	const release = await acquireUpdateLock(installPath());
	try {
		return await performUpdate(options);
	} finally {
		await release();
	}
}

async function performUpdate(options: UpdateOptions) {
	const install = installPath(),
		registration = await installedService();
	const home = registration && resolve(registration.install) === install ? registration.home : options.home;
	const root = await manifest();
	let repository = options.repo ?? (typeof root.repository === "string" ? root.repository : root.repository?.url);
	if (!repository) throw new Error("Repository is not configured; pass --repo <url>");
	repository = canonicalRepository(repository);
	const beforeVersion = await currentVersion(install);
	const receipt: UpdateResult | undefined = home
		? {
				updateId: randomUUID(),
				install,
				home: resolve(home),
				repository,
				...(beforeVersion ? { beforeVersion } : {}),
				verified: false,
				status: "failed-or-unknown",
			}
		: undefined;
	const record = async () => {
		if (!receipt) return {};
		try {
			return { updateId: receipt.updateId, event: await recordUpdateResult(receipt) };
		} catch (error) {
			const eventError = error instanceof Error ? error.message : String(error);
			options.onProgress?.(
				`Update result was not recorded: ${eventError}; do not repeat installation to retry notification.`,
			);
			return { updateId: receipt.updateId, eventError };
		}
	};
	let result: Awaited<ReturnType<typeof installRelease>>;
	try {
		result = await installRelease(options);
	} catch (error) {
		if (receipt) {
			receipt.error = (error instanceof Error ? error.message : String(error)).replaceAll(
				options.repo ?? repository,
				repository,
			);
			await record();
		}
		throw error;
	}
	if (!result.updated || !receipt) return result;
	receipt.version = result.version;
	receipt.tag = `v${result.version}`;
	try {
		const directory = join(install, "versions", result.version);
		const origin = JSON.parse(await readFile(join(directory, ".yonder-install.json"), "utf8")) as {
			commit: string;
			tag: string;
			repository: string;
		};
		receipt.commit = origin.commit;
		if (
			("restartRequired" in result && result.restartRequired) ||
			!registration ||
			resolve(registration.install) !== install
		) {
			receipt.status = "restart-required";
		} else {
			const deadline = Date.now() + 30000;
			let lastError = "Updated service is not ready";
			do {
				try {
					const service = (await requestControl(receipt.home, { method: "service.info" })) as NonNullable<
						UpdateResult["service"]
					>;
					const status = await manageService("status");
					if (
						service.ready === true &&
						service.version === result.version &&
						service.commit === origin.commit &&
						service.home === receipt.home &&
						service.pid > 0 &&
						status.loaded === true &&
						status.pid === service.pid &&
						status.install === install &&
						status.home === receipt.home &&
						origin.tag === receipt.tag &&
						canonicalRepository(origin.repository) === repository &&
						/^[a-f0-9]{40}$/u.test(origin.commit) &&
						(await realpath(join(install, "current"))) === (await realpath(directory))
					) {
						receipt.service = service;
						receipt.verified = true;
						receipt.status = "verified";
						break;
					}
				} catch (error) {
					lastError = error instanceof Error ? error.message : String(error);
				}
				if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1000));
			} while (Date.now() < deadline);
			if (!receipt.verified) receipt.error = lastError;
		}
	} catch (error) {
		receipt.error = error instanceof Error ? error.message : String(error);
	}
	return { ...result, verified: receipt.verified, status: receipt.status, ...(await record()) };
}
