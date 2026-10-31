import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { command } from "./exec.js";
import { installedService } from "./installation.js";
import { linuxServiceUnit } from "./launchers.js";
import { SERVICE_LABEL as label } from "./names.js";
import { installPath, linuxUnitPath } from "./paths.js";
import type { ServiceAction } from "./service-common.js";

export async function manageLinuxService(action: ServiceAction, options: { home?: string }) {
	let installed = await installedService();
	const unit = installed?.label ?? label;
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
		installed = { home, install, plist: linuxUnitPath(), label: unit };
	} else if (action === "uninstall") {
		if (installed) {
			await systemctl(["disable", "--now", unit]);
			await rm(linuxUnitPath(unit));
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
		label: unit,
		state: /^ActiveState=(.+)$/mu.exec(state.stdout)?.[1] ?? "inactive",
		pid,
	};
}
