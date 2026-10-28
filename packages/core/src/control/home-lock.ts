import { join } from "node:path";
import lockfile from "proper-lockfile";

/**
 * The one home lock: the kernel holds it while serving, and offline writers (update result, migrate) must take it
 * too. Same path and default staleness as the kernel, so a live holder is never displaced.
 */
export function lockHome(home: string, onCompromised?: (error: Error) => void): Promise<() => Promise<void>> {
	return lockfile.lock(home, {
		realpath: false,
		lockfilePath: join(home, ".yonder/lock"),
		...(onCompromised ? { onCompromised } : {}),
	});
}
