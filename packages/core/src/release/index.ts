import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
	access,
	chmod,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const label = "dev.yonder.harness";
const statusLabel = "dev.yonder.harness.status";
const statusPlistPath = () => join(homedir(), "Library/LaunchAgents", `${statusLabel}.plist`);
const statusExecutable = (install: string) =>
	join(install, "current/packages/macos/dist/YonderStatus.app/Contents/MacOS/YonderStatus");
const plistPath = () => join(homedir(), "Library/LaunchAgents", `${label}.plist`);
const installPath = () => resolve(process.env.YONDER_INSTALL ?? join(homedir(), ".yonder-harness"));
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const xml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
const domain = () => `gui/${process.getuid?.()}`;
const versionPattern = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export function compareVersions(a: string, b: string): number {
	const left = versionPattern.exec(a),
		right = versionPattern.exec(b);
	if (!left || !right) throw new Error("Version must be X.Y.Z or vX.Y.Z");
	for (let index = 1; index <= 3; index++) {
		const delta = BigInt(left[index] ?? "0") - BigInt(right[index] ?? "0");
		if (delta) return delta < 0n ? -1 : 1;
	}
	return 0;
}
function normalizeVersion(version: string): string {
	if (!versionPattern.test(version)) throw new Error(`Invalid release version: ${version}`);
	return version.replace(/^v/u, "");
}
export function latestRelease(tags: string[]): string {
	const versions = tags.filter((tag) => tag.startsWith("v") && versionPattern.test(tag));
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
interface ServiceInstallation {
	home: string;
	install: string;
	plist: string;
}
async function installedService(): Promise<ServiceInstallation | undefined> {
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
	return [...new Set([join(install, "bin"), dirname(process.execPath), ...(process.env.PATH ?? "").split(":")])]
		.filter(Boolean)
		.join(":");
}
export function launcher(install: string, node = process.execPath, path = runtimePath(install)): string {
	return `#!/bin/sh\nPATH=${shellQuote(path)}\nYONDER_INSTALL=${shellQuote(install)}\nexport PATH YONDER_INSTALL\nexec ${shellQuote(node)} ${shellQuote(join(install, "current/packages/cli/dist/index.js"))} "$@"\n`;
}
export function servicePlist(install: string, home: string, path = runtimePath(install)): string {
	const pair = (key: string, value: string) => `<key>${key}</key><string>${xml(value)}</string>`;
	return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${pair("Label", label)}
<key>ProgramArguments</key><array>${[join(install, "bin/yonder"), "start", "--home", home].map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
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
export type ServiceAction = "install" | "uninstall" | "start" | "stop" | "restart" | "status";
export async function manageService(action: ServiceAction, options: { home?: string } = {}) {
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
		if (await loaded()) await command("launchctl", ["bootout", service]);
		await writeFile(plistPath(), servicePlist(install, home), { mode: 0o600 });
		await command("launchctl", ["bootstrap", domain(), plistPath()]);
		installed = { home, install, plist: plistPath() };
		const statusService = `${domain()}/${statusLabel}`;
		if ((await command("launchctl", ["print", statusService], { allowFailure: true })).code === 0)
			await command("launchctl", ["bootout", statusService]);
		await writeFile(statusPlistPath(), statusPlist(install, home), { mode: 0o600 });
		await command("launchctl", ["bootstrap", domain(), statusPlistPath()]);
	} else if (action === "status") {
		const status = await command("launchctl", ["print", service], { allowFailure: true });
		return {
			installed: !!installed,
			loaded: status.code === 0,
			...(installed ? { home: installed.home, install: installed.install, plist: installed.plist } : {}),
			...(status.code === 0
				? {
						state: /^\s*state = (.+)$/mu.exec(status.stdout)?.[1] ?? "loaded",
						pid: Number(/^\s*pid = (\d+)$/mu.exec(status.stdout)?.[1]) || null,
					}
				: {}),
		};
	} else if (action === "uninstall") {
		if (await loaded()) await command("launchctl", ["bootout", service]);
		const statusService = `${domain()}/${statusLabel}`;
		if ((await command("launchctl", ["print", statusService], { allowFailure: true })).code === 0)
			await command("launchctl", ["bootout", statusService]);
		await rm(statusPlistPath(), { force: true });
		if (installed) await rm(installed.plist);
		return { installed: false, loaded: false };
	} else {
		if (!installed) throw new Error("Yonder Harness service is not installed");
		const running = await loaded();
		if (action === "stop") {
			if (running) await command("launchctl", ["bootout", service]);
		} else if (running) await command("launchctl", ["kickstart", ...(action === "restart" ? ["-k"] : []), service]);
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
async function currentVersion(install: string): Promise<string | undefined> {
	try {
		return basename(await realpath(join(install, "current")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}
async function runningHome(home: string | undefined): Promise<boolean> {
	if (!home) return false;
	const path = join(home, ".yonder/control.sock");
	try {
		if (!(await stat(path)).isSocket()) return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
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
export async function updateRelease(options: UpdateOptions = {}) {
	const install = installPath(),
		versions = join(install, "versions");
	const rootManifest = await manifest();
	const repository =
		options.repo ??
		(typeof rootManifest.repository === "string" ? rootManifest.repository : rootManifest.repository?.url);
	if (!repository) throw new Error("Repository is not configured; pass --repo <url>");
	let target = options.to ?? "latest";
	if (target === "latest") {
		options.onProgress?.("Resolving latest release");
		const refs = await command("git", ["ls-remote", "--tags", "--refs", repository]);
		target = latestRelease(
			refs.stdout.split("\n").flatMap((line) => {
				const tag = line.split("\t")[1]?.replace(/^refs\/tags\//u, "");
				return tag ? [tag] : [];
			}),
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
			await command("npm", ["ci"], { cwd: temporary, env: { ...process.env, PATH: runtimePath(install) } });
			await command("npm", ["run", "build"], { cwd: temporary, env: { ...process.env, PATH: runtimePath(install) } });
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
	const wrapper = join(install, "bin/yonder"),
		newWrapper = `${wrapper}.${randomUUID()}.tmp`;
	const link = join(install, `.current.${randomUUID()}`);
	try {
		await writeFile(newWrapper, launcher(install), { mode: 0o755 });
		await chmod(newWrapper, 0o755);
		await symlink(join("versions", version), link, "dir");
		await rename(newWrapper, wrapper);
		await rename(link, join(install, "current"));
	} finally {
		await rm(newWrapper, { force: true });
		await rm(link, { force: true });
	}
	let restartRequired = false;
	if (thisService) {
		options.onProgress?.("Restarting the service");
		await manageService("restart");
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
