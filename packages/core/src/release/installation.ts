import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { command } from "./exec.js";
import { SERVICE_LABELS } from "./names.js";
import { linuxUnitPath, plistPath, windowsServicePath } from "./paths.js";

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
export interface ServiceInstallation {
	home: string;
	install: string;
	plist: string;
	label?: string;
}
export async function installedService(): Promise<ServiceInstallation | undefined> {
	if (process.platform === "linux") {
		const unit = SERVICE_LABELS.find((candidate) => existsSync(linuxUnitPath(candidate)));
		if (!unit) return;
		const text = await readFile(linuxUnitPath(unit), "utf8");
		const record = /^# YonderService=(.+)$/mu.exec(text)?.[1];
		if (!record) throw new Error("Installed systemd unit is missing its Yonder service record");
		const { home, install } = JSON.parse(record) as { home?: string; install?: string };
		if (!home || !install) throw new Error("Installed systemd unit is missing its home or install");
		return { home, install, plist: linuxUnitPath(unit), label: unit };
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
	const name = SERVICE_LABELS.find((candidate) => existsSync(plistPath(candidate)));
	if (process.platform !== "darwin" || !name) return;
	const result = await command("plutil", ["-convert", "json", "-o", "-", plistPath(name)]);
	const plist = JSON.parse(result.stdout) as {
		ProgramArguments?: string[];
		EnvironmentVariables?: Record<string, string>;
	};
	const args = plist.ProgramArguments ?? [],
		home = args[args.indexOf("--home") + 1];
	if (!args.includes("--home") || !home || !args[0])
		throw new Error("Installed service plist is missing its home or executable");
	return {
		home,
		install: plist.EnvironmentVariables?.YONDER_INSTALL ?? dirname(dirname(args[0])),
		plist: plistPath(name),
		label: name,
	};
}
