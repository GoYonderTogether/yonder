import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ExecutionEnv } from "@yonder/sdk";
import type { WorkspaceFiles } from "../config/index.js";
export function localEnvironment(cwd: string): ExecutionEnv {
	return new NodeExecutionEnv({ cwd });
}
export const canonicalPath = async (env: ExecutionEnv, path: string): Promise<string> =>
	getOrThrow(await env.canonicalPath(path, BACKGROUND_CONTEXT));
export function workspaceFiles(env: ExecutionEnv, signal?: AbortSignal): WorkspaceFiles {
	const context = signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT;
	return {
		readFile: async (path) => getOrThrow(await env.readTextFile(path, context)),
		writeFile: async (path, text) => getOrThrow(await env.writeFile(path, text, context)),
		exists: async (path) => getOrThrow(await env.exists(path, context)),
		list: async (path) =>
			getOrThrow(await env.listDir(path, context)).map((entry) => ({ name: entry.name, type: entry.kind })),
	};
}
