import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const stableDirectory = () => join(homedir(), ".local/share/yonder/helper");
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
function startIdentity(pid) {
	const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() || undefined : undefined;
}
function holderDead(holder) {
	if (!Number.isInteger(holder?.pid) || holder.pid <= 1 || typeof holder.start !== "string" || !holder.start)
		return false;
	try {
		process.kill(holder.pid, 0);
	} catch (error) {
		return error.code === "ESRCH"; // EPERM/unknown is not evidence of death.
	}
	const current = startIdentity(holder.pid);
	return current !== undefined && current !== holder.start;
}
export async function acquireInstallLock(home) {
	const lock = join(home, "install.lock");
	try {
		await mkdir(lock, { mode: 0o700 });
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		const before = await stat(lock);
		const holder = JSON.parse(await readFile(join(lock, "holder.json"), "utf8"));
		if (!holderDead(holder)) throw new Error("Helper install lock is held or its owner cannot be proven dead");
		// One recovery claimant inside the OLD directory. Other contenders cannot
		// remove/recreate it under us. Missing/partial holder records fail closed.
		await mkdir(join(lock, "recover"));
		const after = await stat(lock);
		const latest = JSON.parse(await readFile(join(lock, "holder.json"), "utf8"));
		if (before.ino !== after.ino || latest.token !== holder.token || !holderDead(latest))
			throw new Error("Helper install lock changed during recovery");
		await rm(lock, { recursive: true });
		await mkdir(lock, { mode: 0o700 }); // A concurrent new owner wins explicitly.
	}
	const token = randomUUID();
	const start = startIdentity(process.pid);
	if (!start) {
		await rm(lock, { recursive: true });
		throw new Error("Cannot identify helper installer lock holder");
	}
	await writeFile(join(lock, "holder.json"), JSON.stringify({ pid: process.pid, start, token }), { mode: 0o600 });
	return async () => {
		const holder = JSON.parse(await readFile(join(lock, "holder.json"), "utf8"));
		if (holder.token !== token) throw new Error("Helper install lock ownership changed");
		await rm(lock, { recursive: true });
	};
}
export async function installHelper(root, directory = stableDirectory()) {
	root = await realpath(root);
	// A development checkout can only install into an explicit isolated directory.
	// Production uses the selected installed release, including after rollback.
	if (resolve(directory) === resolve(stableDirectory())) {
		const install = process.env.YONDER_INSTALL ?? join(homedir(), ".yonder");
		if (root !== (await realpath(join(install, "current"))))
			throw new Error(
				"Production Helper installation requires the current installed release, not a development checkout",
			);
		await readFile(join(root, ".yonder-install.json"));
	}
	const home = directory;
	const app = join(home, "Yonder Helper.app");
	const source = join(root, "packages/macos-helper/dist/Yonder Helper.app");
	const script = join(root, "scripts/yonder-permissions.mjs");
	await stat(script);
	const wrapper = `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`;
	const codeHash = (path) => {
		const result = spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", path], { encoding: "utf8" });
		if (result.status !== 0) throw new Error(`Helper missing or unsigned: run npm run build (${path})`);
		const hash = result.stderr.match(/^CDHash=(\w+)$/mu)?.[1];
		if (!hash) throw new Error("Missing helper CDHash");
		return hash;
	};
	await mkdir(home, { recursive: true, mode: 0o700 });
	const release = await acquireInstallLock(home);
	const suffix = `${process.pid}.${randomUUID()}`;
	const pending = join(home, `Yonder Helper.${suffix}.app`);
	const backup = join(home, `Yonder Helper.${suffix}.previous.app`);
	const wrapperPath = join(home, "yonder-permissions");
	const pendingWrapper = `${wrapperPath}.${suffix}`;
	let saved = false;
	let replaced = false;
	let committed = false;
	try {
		const desired = codeHash(source);
		let installed;
		try {
			installed = codeHash(app);
		} catch {}
		await writeFile(pendingWrapper, wrapper, { mode: 0o700, flag: "wx" });
		if (installed !== desired) {
			await cp(source, pending, { recursive: true });
			execFileSync("/usr/bin/codesign", ["--verify", "--strict", pending]);
			try {
				await rename(app, backup);
				saved = true;
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			await rename(pending, app);
			replaced = true;
		}
		await rename(pendingWrapper, wrapperPath);
		committed = true;
	} catch (error) {
		if (replaced) await rm(app, { recursive: true });
		if (saved) await rename(backup, app);
		throw error;
	} finally {
		try {
			await rm(pending, { recursive: true, force: true });
			await rm(pendingWrapper, { force: true });
			if (committed) await rm(backup, { recursive: true, force: true });
		} finally {
			await release();
		}
	}
	return { home, app };
}
