import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The connector state directory (spec 23 §3). `@yonder/connect` writes `config.json` here
 * and the connector reads it; nothing else on the machine is touched, and no process
 * environment, PATH entry or global command is created.
 */

export interface StoredConfig {
	endpoint: string;
	deviceToken: string;
}

/** `$DSH_HOME/yonder`, with the same defaulting DSH itself uses. */
export function dshStateDir(dshHome: string): string {
	return join(resolve(dshHome), "yonder");
}

export function configPath(dir: string): string {
	return join(dir, "config.json");
}

export function readConfig(dir: string): StoredConfig | undefined {
	const path = configPath(dir);
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		const row = parsed as { endpoint?: unknown; deviceToken?: unknown };
		if (typeof row.endpoint !== "string" || typeof row.deviceToken !== "string") return undefined;
		return { endpoint: row.endpoint, deviceToken: row.deviceToken };
	} catch {
		return undefined;
	}
}

/** Write the device token with owner-only permissions (0600) inside a 0700 directory. */
export function writeConfig(dir: string, config: StoredConfig): string {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const path = configPath(dir);
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
	return path;
}

/** Remove this connector's files; returns what was removed. */
export function clearConfig(dir: string): string[] {
	const removed: string[] = [];
	for (const name of ["config.json", "state.json"]) {
		const path = join(dir, name);
		if (!existsSync(path)) continue;
		try {
			unlinkSync(path);
			removed.push(path);
		} catch {
			/* Already gone. */
		}
	}
	return removed;
}

export type Launcher = (command: string, args: string[], callback: (error: Error | null) => void) => void;

/** Open a URL in the user's browser without blocking or failing the installer. */
export function openBrowser(url: string, run: Launcher = execFile): void {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	run(command, args, () => {});
}
