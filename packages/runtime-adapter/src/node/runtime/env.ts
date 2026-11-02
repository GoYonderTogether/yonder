import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ExecutionEnv } from "@yonder/sdk";
import { hostedProcessSpawner } from "./hosted-process.js";
import { windowsProcessSpawn } from "./windows-process.js";

export { canonicalPath, workspaceFiles } from "../../workspace-files.js";
export function localEnvironment(cwd: string): ExecutionEnv {
	const localSpawn = hostedProcessSpawner() ?? (process.platform === "win32" ? windowsProcessSpawn : undefined);
	return new NodeExecutionEnv({ cwd, ...(localSpawn ? { localSpawn } : {}) });
}
