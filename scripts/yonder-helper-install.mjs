import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function installHelper(root, directory = join(homedir(), ".local/share/yonder-harness/helper")) {
	const home = directory;
	const app = join(home, "Yonder Helper.app");
	const source = join(root, "packages/macos-helper/dist/Yonder Helper.app");
	// codesign writes inspection to stderr, including on success.
	const codeHash = (path) => {
		const result = spawnSyncCode(path);
		return (
			result.match(/^CDHash=(\w+)$/mu)?.[1] ??
			(() => {
				throw new Error("Missing helper CDHash");
			})()
		);
	};
	function spawnSyncCode(path) {
		const result = spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", path], { encoding: "utf8" });
		if (result.status !== 0) throw new Error(`Helper missing or unsigned: run npm run build (${path})`);
		return result.stderr;
	}
	await mkdir(home, { recursive: true, mode: 0o700 });
	const desired = codeHash(source);
	let installed;
	try {
		installed = codeHash(app);
	} catch {}
	if (installed !== desired) {
		const lock = join(home, "install.lock");
		await mkdir(lock); // Concurrent upgrade fails explicitly; never overwrite another install.
		try {
			const pending = join(home, `Yonder Helper.${process.pid}.app`);
			await cp(source, pending, { recursive: true });
			execFileSync("/usr/bin/codesign", ["--verify", "--strict", pending]);
			await rm(app, { recursive: true, force: true });
			await rename(pending, app);
		} finally {
			await rm(lock, { recursive: true });
		}
	}
	return { home, app };
}
