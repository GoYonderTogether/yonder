import { realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SkillSource as BotSkillSource, SourceDirectory, SourceSession } from "@yonder/bot-definition/source";
import { localSourceDirectory } from "@yonder/local-host/config/fs-source";
import type { WorkspaceFiles } from "@yonder/local-host/config/index";
import { canonicalPath } from "@yonder/runtime-adapter/workspace-files.js";
import type { ExecutionEnv } from "@yonder/sdk";

export type SkillOrigin = BotSkillSource["source"];

export interface SkillWorkspace {
	root: string;
	files: WorkspaceFiles;
	location: string;
	env?: ExecutionEnv;
}

export interface FsSkillSourcesOptions {
	userHome?: string;
	pluginDirs?: string[];
	pluginSources?: ReadonlyMap<string, string>;
	workspace?: SkillWorkspace;
}

const builtinRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const canonical =
	(env?: ExecutionEnv) =>
	async (path: string): Promise<string> => {
		try {
			return env ? await canonicalPath(env, path) : await realpath(path);
		} catch {
			return path;
		}
	};

export function fsPluginSkillSources(dirs: string[], sources?: ReadonlyMap<string, string>): BotSkillSource[] {
	return dirs.map((directory) => {
		const root = resolve(directory);
		return {
			root,
			base: ".",
			source: `plugin:${sources?.get(directory) ?? "unknown"}`,
			location: root,
			files: localSourceDirectory(root).files,
			canonical: canonical(),
		};
	});
}

/** Filesystem skill roots in the existing priority order. */
export async function fsSkillSources(
	home: SourceDirectory,
	session: SourceSession,
	options: FsSkillSourcesOptions = {},
	plugins: BotSkillSource[] = [],
): Promise<BotSkillSource[]> {
	const result: BotSkillSource[] = [];
	const add = (
		root: string,
		base: string,
		source: BotSkillSource["source"],
		location: string,
		files: WorkspaceFiles,
		env?: ExecutionEnv,
	) => result.push({ root, base, source, location, files, canonical: canonical(env) });

	if (options.workspace)
		add(
			options.workspace.root,
			"skills",
			"workspace",
			options.workspace.location,
			options.workspace.files,
			options.workspace.env,
		);
	if (options.userHome) {
		const root = join(options.userHome, ".agents");
		const files = localSourceDirectory(root).files;
		add(root, "skills", "agents", join(root, "skills"), files);
	}
	add(home.root, "skills", "home", "home", home.files);

	const chain: string[] = [];
	let current = resolve(session.cwd);
	let repositoryRoot: string | undefined;
	while (true) {
		chain.push(current);
		if (repositoryRoot === undefined && (await localSourceDirectory(current).files.exists(".git")))
			repositoryRoot = current;
		if (repositoryRoot !== undefined && current === repositoryRoot) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	for (const directory of chain.reverse()) {
		const root = join(directory, ".agents", "skills");
		add(root, ".", "project-agents", root, localSourceDirectory(root).files);
	}
	const projectRoot = join(resolve(session.cwd), ".pi", "skills");
	add(projectRoot, ".", "project", projectRoot, localSourceDirectory(projectRoot).files);
	result.push(...fsPluginSkillSources(options.pluginDirs ?? [], options.pluginSources), ...plugins);
	add(builtinRoot, "skills", "builtin", "builtin", localSourceDirectory(builtinRoot).files);
	return result;
}

export type { BotSkillSource, SourceSession };
