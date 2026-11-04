import { join } from "node:path";
import type { WorkspaceFiles } from "./index.js";
import type { YonderConfig } from "./schema.js";
import { loadSubagentDefinitionsFrom } from "./subagents.js";

export interface SourceDirectory {
	root: string;
	files: WorkspaceFiles;
}
export interface SourceSession {
	agent: string | null;
	profile: string;
	cwd: string;
}
export interface TemplateSource extends SourceDirectory {
	tools?: string[];
}
export type SkillOrigin =
	| "workspace"
	| "home"
	| "agents"
	| "project-agents"
	| "project"
	| "builtin"
	| `plugin:${string}`;
export interface SkillSource extends SourceDirectory {
	base: string;
	source: SkillOrigin;
	location: string;
	canonical(path: string): Promise<string>;
}
export type AgentEntry = NonNullable<YonderConfig["agents"]>[number];

/** Definition assets are supplied by the host; parsing and selection stay shared. */
export interface BotSource {
	home: SourceDirectory;
	workspace(entry: AgentEntry, signal?: AbortSignal): WorkspaceFiles;
	templates(session: SourceSession, plugins?: TemplateSource[]): Promise<TemplateSource[]>;
	skills(session: SourceSession, plugins?: SkillSource[]): Promise<SkillSource[]>;
}

/** A view of an existing source tree; no new storage or copy is created. */
export function sourceDirectory(directory: SourceDirectory, path: string): SourceDirectory {
	const root = join(directory.root, path);
	const file = (name: string) => join(path, name);
	return {
		root,
		files: {
			readFile: (name) => directory.files.readFile(file(name)),
			writeFile: (name, text) => directory.files.writeFile(file(name), text),
			exists: (name) => directory.files.exists(file(name)),
			list: (name) => directory.files.list(file(name)),
		},
	};
}

export async function definitionTemplates(
	home: SourceDirectory,
	session: SourceSession,
	plugins: TemplateSource[] = [],
): Promise<TemplateSource[]> {
	const safe = (value: string) =>
		value && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\");
	const { agent, profile } = session;
	return [
		...(agent && safe(agent) ? [sourceDirectory(home, join("agents", agent, "prompts"))] : []),
		...(!agent && safe(profile) && (await loadSubagentDefinitionsFrom(home)).has(profile)
			? [sourceDirectory(home, join("agents", profile, "prompts"))]
			: []),
		...(!agent && safe(profile) ? [sourceDirectory(home, join("presets", profile, "prompts"))] : []),
		sourceDirectory(home, "prompts"),
		...plugins,
	];
}
