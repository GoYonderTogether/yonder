import { isAbsolute, relative, sep } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ExecutionEnv } from "@yonder/sdk";
import type { WorkspaceFiles } from "../config/index.js";
import { hostedProcessSpawner } from "./hosted-process.js";
import { shellCommand } from "./windows-process.js";
export function localEnvironment(cwd: string): ExecutionEnv {
	const localSpawn = hostedProcessSpawner();
	const env = new NodeExecutionEnv({ cwd, ...(localSpawn ? { localSpawn } : {}) });
	if (process.platform === "win32") {
		const exec = env.exec.bind(env);
		env.exec = (command, options, context) => {
			const shell = typeof command === "string" ? shellCommand(command) : undefined;
			return exec(shell ? [shell.program, ...shell.args] : command, options, context);
		};
	}
	return env;
}
export const canonicalPath = async (env: ExecutionEnv, path: string): Promise<string> =>
	getOrThrow(await env.canonicalPath(path, BACKGROUND_CONTEXT));
export function workspaceFiles(env: ExecutionEnv, signal?: AbortSignal, root?: string): WorkspaceFiles {
	const context = signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT;
	return {
		readFile: async (path) => {
			if (root !== undefined) {
				const base = getOrThrow(await env.canonicalPath(root, context));
				const target = getOrThrow(await env.canonicalPath(path, context));
				const rel = relative(base, target);
				if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
					throw new Error("Workspace context path escapes workspace");
				path = target;
			}
			return getOrThrow(await env.readTextFile(path, context));
		},
		writeFile: async (path, text) => getOrThrow(await env.writeFile(path, text, context)),
		exists: async (path) => getOrThrow(await env.exists(path, context)),
		list: async (path) =>
			getOrThrow(await env.listDir(path, context)).map((entry) => ({ name: entry.name, type: entry.kind })),
	};
}
