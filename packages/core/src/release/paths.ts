import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installRoot, SERVICE_LABEL as label, STATUS_LABEL as statusLabel } from "./names.js";

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const statusPlistPath = (name = statusLabel) => join(homedir(), "Library/LaunchAgents", `${name}.plist`);
export const statusExecutable = (install: string) =>
	join(install, "current/packages/macos/dist/YonderStatus.app/Contents/MacOS/YonderStatus");
export const plistPath = (name = label) => join(homedir(), "Library/LaunchAgents", `${name}.plist`);
export const windowsData = () => resolve(process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "YonderHarness");
export const installPath = () => installRoot(process.env);
export const linuxUnitPath = (unit = label) =>
	join(resolve(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")), "systemd/user", unit);
export const windowsServicePath = () => join(windowsData(), "service.json");
export const windowsTask = label;
export async function manifest(
	root = sourceRoot,
): Promise<{ version: string; repository?: string | { url?: string } }> {
	return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
}
export function runtimePath(install: string): string {
	return [...new Set([join(install, "bin"), dirname(process.execPath), ...(process.env.PATH ?? "").split(delimiter)])]
		.filter(Boolean)
		.join(delimiter);
}
