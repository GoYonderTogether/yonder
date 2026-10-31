import { existsSync } from "node:fs";
import { access, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { command } from "./exec.js";
import { installedService, unloadService } from "./installation.js";
import { serviceLauncher, servicePlist, statusPlist } from "./launchers.js";
import { SERVICE_LABEL as label, SERVICE_LABELS, STATUS_LABELS, STATUS_LABEL as statusLabel } from "./names.js";
import { installPath, plistPath, runtimePath, statusExecutable, statusPlistPath } from "./paths.js";
import { domain, loadedLabel, type ServiceAction, type ServiceStatus } from "./service-common.js";
import { manageLinuxService } from "./service-linux.js";
import { manageWindowsService } from "./service-windows.js";

export type { ServiceAction, ServiceStatus };

export async function manageService(action: ServiceAction, options: { home?: string } = {}): Promise<ServiceStatus> {
	if (process.platform === "linux") return manageLinuxService(action, options);
	if (process.platform === "win32") return manageWindowsService(action, options);
	if (process.platform !== "darwin")
		throw new Error("Yonder Harness background services currently support macOS launchd only");
	let installed = await installedService();
	const name = installed?.label ?? (await loadedLabel(SERVICE_LABELS)) ?? label;
	const service = `${domain()}/${name}`;
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
		installed = { home, install, plist: plistPath(), label };
		if (name !== label) await rm(plistPath(name), { force: true });
		const statusName = (await loadedLabel(STATUS_LABELS)) ?? statusLabel;
		const statusService = `${domain()}/${statusName}`;
		if ((await command("launchctl", ["print", statusService], { allowFailure: true })).code === 0)
			await unloadService(statusService);
		await writeFile(statusPlistPath(), statusPlist(install, home), { mode: 0o600 });
		await command("launchctl", ["bootstrap", domain(), statusPlistPath()]);
		if (statusName !== statusLabel) await rm(statusPlistPath(statusName), { force: true });
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
			label: name,
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
		const statusName = await loadedLabel(STATUS_LABELS);
		if (statusName) await unloadService(`${domain()}/${statusName}`);
		for (const candidate of STATUS_LABELS) await rm(statusPlistPath(candidate), { force: true });
		for (const candidate of SERVICE_LABELS) await rm(plistPath(candidate), { force: true });
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
		const statusName = (await loadedLabel(STATUS_LABELS)) ?? statusLabel;
		const statusService = `${domain()}/${statusName}`;
		const statusPlist = statusPlistPath(statusName);
		if (action === "start" && existsSync(statusPlist)) {
			if ((await command("launchctl", ["print", statusService], { allowFailure: true })).code !== 0)
				await command("launchctl", ["bootstrap", domain(), statusPlist]);
			else await command("launchctl", ["kickstart", statusService]);
		} else if (action === "restart") {
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
		label: installed.label ?? name,
	};
}
