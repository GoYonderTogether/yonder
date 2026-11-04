import { homedir } from "node:os";
import { resolve } from "node:path";
import type { AgentEntry, BotSource, SkillSource, SourceSession, TemplateSource } from "@yonder/bot-definition/source";
import { definitionTemplates } from "@yonder/bot-definition/source";
import { localSourceDirectory } from "@yonder/local-host/config/fs-source";
import type { WorkspaceFiles } from "@yonder/local-host/config/index";
import { fsSkillSources } from "@yonder/local-host/skills/source-fs";
import { localEnvironment } from "@yonder/runtime-adapter/node/runtime/env.js";
import { workspaceFiles } from "@yonder/runtime-adapter/workspace-files.js";
import type { ExecutionEnv } from "@yonder/sdk";

export function createFsBotSource(
	home: string,
	options: { envs?: () => Map<string, ExecutionEnv>; agents?: () => readonly AgentEntry[] } = {},
): BotSource {
	const homeSource = localSourceDirectory(resolve(home));
	const workspace = (entry: AgentEntry, signal?: AbortSignal): WorkspaceFiles => {
		const root = resolve(home, entry.workspace);
		if (!entry.env || entry.env === "local") return workspaceFiles(localEnvironment(root), signal, root);
		const env = options.envs?.().get(entry.env);
		if (!env) throw new Error(`Unknown workspace environment: ${entry.env}`);
		const files = workspaceFiles(env, signal, root);
		return {
			readFile: (path) => files.readFile(resolve(root, path)),
			writeFile: (path, text) => files.writeFile(resolve(root, path), text),
			exists: (path) => files.exists(resolve(root, path)),
			list: (path) => files.list(resolve(root, path)),
		};
	};
	return {
		home: homeSource,
		workspace,
		templates: (session: SourceSession, plugins?: TemplateSource[]) =>
			definitionTemplates(homeSource, session, plugins),
		skills: async (session: SourceSession, plugins?: SkillSource[]) => {
			const entry = session.agent ? options.agents?.().find(({ id }) => id === session.agent) : undefined;
			if (session.agent && !entry) throw new Error(`Unknown agent: ${session.agent}`);
			const root = entry ? resolve(home, entry.workspace) : undefined;
			const env =
				entry && (!entry.env || entry.env === "local")
					? localEnvironment(resolve(home, entry.workspace))
					: entry?.env
						? options.envs?.().get(entry.env)
						: undefined;
			if (entry?.env && entry.env !== "local" && !env) throw new Error(`Unknown workspace environment: ${entry.env}`);
			return fsSkillSources(
				homeSource,
				session,
				{
					userHome: homedir(),
					...(entry && root && env
						? {
								workspace: {
									root,
									files: workspace(entry),
									location: `workspace:${entry.env ?? "local"}`,
									env,
								},
							}
						: {}),
				},
				plugins ?? [],
			);
		},
	};
}
