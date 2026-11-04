import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
	access,
	chmod,
	lstat,
	mkdir,
	readdir,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { basename, join, relative, resolve } from "node:path";

import { controlEndpoint } from "@yonder/local-host/control/index";
import { command } from "@yonder/local-host/release/exec";
import { installedService } from "@yonder/local-host/release/installation";
import {
	launcher,
	windowsLauncher,
	windowsWorkspaceLauncher,
	workspaceBins,
	workspaceLauncher,
} from "@yonder/local-host/release/launchers";
import { installPath, manifest, runtimePath } from "@yonder/local-host/release/paths";
import { manageService } from "@yonder/local-host/release/service";
import { latestRelease, normalizeVersion, versionPattern } from "@yonder/local-host/release/versions";

export interface UpdateOptions {
	to?: string;
	repo?: string;
	home?: string;
	onProgress?: (stage: string) => void;
}

function npmCommand(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) {
	return process.platform === "win32"
		? command("cmd.exe", ["/d", "/s", "/c", "npm", ...args], options)
		: command("npm", args, options);
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
export async function currentVersion(install: string): Promise<string | undefined> {
	if (process.platform === "win32") return managedVersionLink(install, join(install, "current"));
	try {
		return basename(await realpath(join(install, "current")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
}
export async function runningHome(home: string | undefined): Promise<boolean> {
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
export async function installRelease(options: UpdateOptions = {}) {
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
		// The install must expose the real workspace binaries, not only `yonder` itself.
		for (const binary of workspaceBins) {
			const file = join(install, "bin", process.platform === "win32" ? `${binary.name}.cmd` : binary.name);
			const temp = `${file}.${randomUUID()}.tmp`;
			await writeFile(
				temp,
				process.platform === "win32"
					? windowsWorkspaceLauncher(install, binary.entry)
					: workspaceLauncher(install, binary.entry),
				{ mode: 0o755 },
			);
			if (process.platform !== "win32") await chmod(temp, 0o755);
			await rename(temp, file);
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
