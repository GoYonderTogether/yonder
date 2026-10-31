import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { requestControl } from "../control/index.js";
import { command } from "./exec.js";
import { installedService } from "./installation.js";
import { windowsServiceLauncher } from "./launchers.js";
import { installPath, windowsServicePath, windowsTask } from "./paths.js";
import type { ServiceAction } from "./service-common.js";

export async function manageWindowsService(action: ServiceAction, options: { home?: string }) {
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
