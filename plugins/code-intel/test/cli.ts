import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * True when `command` resolves to an executable file on PATH.
 * The real-CLI tests skip instead of failing where the external tool is missing or not executable.
 */
export function executable(command: string): boolean {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		try {
			accessSync(join(dir, command), constants.X_OK);
			return true;
		} catch {}
	}
	return false;
}
