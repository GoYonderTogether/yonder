import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SERVICE_LABEL = "dev.yonder.service";
export const STATUS_LABEL = "dev.yonder.status";
// Never change: TCC authorization and the signing designated requirement are bound to this ID.
export const HELPER_ID = "dev.yonder.harness.helper";
export const LEGACY_INSTALL_DIR = ".yonder-harness";
export const LEGACY_LABELS = ["dev.yonder.harness", "dev.yonder.harness.service", "dev.yonder.harness.status"];
export const LEGACY_HOME_DIR = "yonder-harness";

export function installRoot(env: NodeJS.ProcessEnv): string {
	return resolve(env.YONDER_INSTALL ?? join(homedir(), ".local/share/yonder/install"));
}
