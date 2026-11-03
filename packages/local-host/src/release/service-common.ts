import { command } from "@yonder/local-host/release/exec";

export const domain = () => `gui/${process.getuid?.()}`;
/** The label this machine actually runs: the current one first, then pre-S-N01 spellings still loaded. */
export async function loadedLabel(names: string[]): Promise<string | undefined> {
	for (const name of names)
		if ((await command("launchctl", ["print", `${domain()}/${name}`], { allowFailure: true })).code === 0) return name;
}

export type ServiceAction = "install" | "uninstall" | "start" | "stop" | "restart" | "status";
export interface ServiceStatus {
	installed: boolean;
	loaded: boolean;
	home?: string;
	install?: string;
	plist?: string;
	label?: string;
	state?: string;
	pid?: number | null;
	launcherPid?: number | null;
	/** Windows only: whether the tray's login task is registered (unavailable = this install has no tray build). */
	statusIcon?: "installed" | "unavailable";
}
