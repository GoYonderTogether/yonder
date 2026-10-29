import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Map an existing local socket path to the platform's IPC address. */
export function localIpcPath(path: string): string {
	if (process.platform !== "win32") return path;
	const identity = `${resolve(homedir()).toLowerCase()}\0${resolve(path).toLowerCase()}`;
	return `\\\\.\\pipe\\yonder-${createHash("sha256").update(identity).digest("hex")}`;
}
