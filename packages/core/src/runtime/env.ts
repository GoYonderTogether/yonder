import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ExecutionEnv } from "@yonder/sdk";
import type { WorkspaceFiles } from "../config/index.js";
export function localEnvironment(cwd: string): ExecutionEnv {
	return new NodeExecutionEnv({ cwd });
}
export function workspaceFiles(env: ExecutionEnv): WorkspaceFiles {
	return {
		readFile: async (path) => getOrThrow(await env.readTextFile(path, BACKGROUND_CONTEXT)),
		writeFile: async (path, text) => getOrThrow(await env.writeFile(path, text, BACKGROUND_CONTEXT)),
		exists: async (path) => getOrThrow(await env.exists(path, BACKGROUND_CONTEXT)),
		list: async (path) =>
			getOrThrow(await env.listDir(path, BACKGROUND_CONTEXT)).map((entry) => ({ name: entry.name, type: entry.kind })),
	};
}
