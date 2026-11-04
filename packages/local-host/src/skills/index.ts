import type { SkillIssue } from "@yonder/bot-core/skills/index";
import { createSkills as create } from "@yonder/bot-core/skills/index";
import type { WorkspaceFiles } from "@yonder/bot-definition";
import type { SkillSource as BotSkillSource, BotSource } from "@yonder/bot-definition/source";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import type { ExecutionEnv } from "@yonder/sdk";
import { localSourceDirectory } from "../config/fs-source.js";
import { createFsBotSource } from "../kernel/source-fs.js";
import { fsSkillSources } from "./source-fs.js";

export * from "@yonder/bot-core/skills/index";
export * from "./manage.js";
export interface CreateSkillsOptions {
	home: string;
	source?: BotSource;
	/** OS user home; its `.agents/skills` is the user-level Agent Skills location, as in pi. */
	userHome?: string;
	pluginDirs: string[];
	pluginSources?: ReadonlyMap<string, string>;
	workspace?: (
		session: RuntimeSessionConfig,
	) => { files: WorkspaceFiles; root: string; location: string; env: ExecutionEnv } | undefined;
	onIssue?: (issue: SkillIssue) => void;
}

export function createSkills(options: CreateSkillsOptions) {
	const base = options.source ?? createFsBotSource(options.home);
	const source: BotSource = options.source ?? {
		...base,
		skills: (session, plugins: BotSkillSource[] = []) =>
			fsSkillSources(
				localSourceDirectory(options.home),
				session,
				{
					...(options.userHome ? { userHome: options.userHome } : {}),
					pluginDirs: options.pluginDirs,
					...(options.pluginSources ? { pluginSources: options.pluginSources } : {}),
					...(options.workspace?.(session as RuntimeSessionConfig)
						? { workspace: options.workspace(session as RuntimeSessionConfig)! }
						: {}),
				},
				plugins,
			),
	};
	return create({ source, ...(options.onIssue ? { onIssue: options.onIssue } : {}) });
}
