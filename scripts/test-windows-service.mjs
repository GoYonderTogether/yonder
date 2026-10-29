import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { initHome, requestControl } from "../packages/core/dist/index.js";
import {
	installedWindowsService,
	manageWindowsService,
	windowsCommand,
	windowsLauncher,
} from "../packages/core/dist/release/windows.js";

if (process.platform !== "win32") throw new Error("Requires native Windows");
if (await installedWindowsService()) throw new Error("An existing service is registered; leave it untouched");
const root = await mkdtemp(join(tmpdir(), "yonder-service-"));
const install = join(root, "install"),
	home = join(root, "home");
process.env.LOCALAPPDATA = join(root, "appdata");
const task = `Yonder Harness ${Buffer.from((await import("node:os")).homedir().toLowerCase())
	.toString("hex")
	.slice(-32)}`;
if (await windowsCommand(`$t=Get-ScheduledTask -TaskName '${task}' -ErrorAction SilentlyContinue; if($t){'exists'}`))
	throw new Error("An existing task is present; leave it untouched");
await mkdir(join(install, "bin"), { recursive: true });
await symlink(resolve("."), join(install, "current"), "junction");
await writeFile(join(install, "bin/yonder.cmd"), windowsLauncher(install));
await initHome(home, "owner", { isolated: true });
const ready = async () => {
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		try {
			const info = await requestControl(home, { method: "service.info" });
			if (info.ready) return info;
		} catch {}
		await sleep(250);
	}
	throw new Error(
		`Service not ready: ${await readFile(join(home, ".yonder/logs/harness.log"), "utf8").catch(() => "no log")}`,
	);
};
try {
	await manageWindowsService("install", install, home);
	const first = await ready();
	assert.equal((await manageWindowsService("status", install)).pid, first.pid);
	await manageWindowsService("restart", install);
	const second = await ready();
	assert.notEqual(second.pid, first.pid);
	await manageWindowsService("stop", install);
	assert.equal((await manageWindowsService("status", install)).loaded, false);
	await manageWindowsService("start", install);
	await ready();
	await manageWindowsService("uninstall", install);
	assert.equal((await manageWindowsService("status", install)).installed, false);
	console.log("Windows scheduled service: install/status/restart/stop/start/uninstall passed");
} finally {
	if (await installedWindowsService()) await manageWindowsService("uninstall", install);
	// Remove only the junction itself before recursively cleaning this verified scratch root.
	await rm(join(install, "current"), { force: true });
	await rm(root, { recursive: true, force: true });
}
