import { readdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionEnv, ToolResult } from "@yonder/sdk";
import { parse } from "yaml";
import { matchesGlob, type WorkspaceFiles } from "../config/index.js";
import { canonicalPath } from "../runtime/env.js";
import type { RuntimeSessionConfig } from "../runtime/types.js";

export type SkillSource = "workspace" | "home" | "builtin" | `plugin:${string}`;
const builtinRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
interface SkillFiles {
	root: string;
	base: string;
	source: SkillSource;
	location: string;
	files: WorkspaceFiles;
	env?: ExecutionEnv;
}
export interface SkillInfo {
	name: string;
	description: string;
	source: SkillSource;
	location: string;
	disableModelInvocation: boolean;
	shadowed: boolean;
	shadowedBy?: string;
	selected: boolean;
	indexed: boolean;
	estimatedTokens: number;
}
interface SkillEntry extends SkillInfo {
	directory: string;
	relativeDirectory: string;
	file: string;
	files: WorkspaceFiles;
	env?: ExecutionEnv;
}
export interface SkillIssue {
	source: SkillSource;
	path: string;
	message: string;
}
export interface SkillsReport {
	skills: SkillInfo[];
	issues: SkillIssue[];
	index: string;
	estimatedTokens: number;
}
interface CreateSkillsOptions {
	home: string;
	pluginDirs: string[];
	pluginSources?: ReadonlyMap<string, string>;
	workspace?: (
		session: RuntimeSessionConfig,
	) => { files: WorkspaceFiles; root: string; location: string; env: ExecutionEnv } | undefined;
	onIssue?: (issue: SkillIssue) => void;
}

const hostFiles = (root: string): WorkspaceFiles => ({
	readFile: (path) => readFile(join(root, path), "utf8"),
	writeFile: async () => {
		throw new Error("read only");
	},
	exists: async (path) => {
		try {
			await realpath(join(root, path));
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	},
	list: async (path) =>
		(await readdir(join(root, path), { withFileTypes: true })).map((entry) => ({
			name: entry.name,
			type: entry.isFile() ? ("file" as const) : entry.isDirectory() ? ("directory" as const) : ("symlink" as const),
		})),
});

function inside(root: string, target: string): boolean {
	const path = relative(root, target);
	return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function discover(source: SkillFiles): Promise<Array<{ file: string; directory: string }>> {
	const result: Array<{ file: string; directory: string }> = [];
	const visit = async (path: string): Promise<void> => {
		for (const entry of (await source.files.list(path)).sort((a, b) => compare(a.name, b.name))) {
			const child = path === "." ? entry.name : join(path, entry.name);
			if (entry.type === "directory") await visit(child);
			else if (entry.type === "file" && entry.name === "SKILL.md")
				result.push({ file: child, directory: dirname(child) });
		}
	};
	if (await source.files.exists(source.base)) await visit(source.base);
	return result;
}

export function parseSkillFrontmatter(text: string): {
	name: string;
	description: string;
	disableModelInvocation: boolean;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!match) throw new Error("缺少 YAML frontmatter");
	const data: unknown = parse(match[1]!);
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("frontmatter 必须是映射");
	const value = data as Record<string, unknown>;
	if (typeof value.name !== "string" || value.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name))
		throw new Error("name 格式无效（需为最多 64 字符的小写字母、数字、连字符）");
	if (typeof value.description !== "string" || !value.description.trim() || value.description.length > 1024)
		throw new Error("description 必填且不得超过 1024 字符");
	return {
		name: value.name,
		description: value.description,
		disableModelInvocation: value["disable-model-invocation"] === true,
	};
}

const escapeXml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function createSkills({ home, pluginDirs, pluginSources, workspace, onIssue }: CreateSkillsOptions) {
	const sourceFor = (session: RuntimeSessionConfig): SkillFiles[] => {
		const workspaceSource = workspace?.(session);
		return [
			...(workspaceSource ? [{ ...workspaceSource, base: "skills", source: "workspace" as const }] : []),
			{ root: home, base: "skills", source: "home", location: "home", files: hostFiles(home) },
			...pluginDirs.map((directory) => ({
				root: directory,
				base: ".",
				source: `plugin:${pluginSources?.get(directory) ?? "unknown"}` as const,
				location: directory,
				files: hostFiles(directory),
			})),
			{
				root: builtinRoot,
				base: "skills",
				source: "builtin",
				location: "builtin",
				files: hostFiles(builtinRoot),
			},
		];
	};

	async function inspectInternal(
		session: RuntimeSessionConfig,
	): Promise<{ skills: SkillEntry[]; issues: SkillIssue[]; index: string; estimatedTokens: number }> {
		const issues: SkillIssue[] = [];
		const skills: SkillEntry[] = [];
		const winners = new Map<string, SkillEntry>();
		for (const source of sourceFor(session)) {
			for (const found of await discover(source)) {
				const fullFile = join(source.root, found.file);
				try {
					const parsed = parseSkillFrontmatter(await source.files.readFile(found.file));
					const selected = (session.resolved.skills ?? ["*"]).some((pattern) => matchesGlob(pattern, parsed.name));
					const directory = resolve(source.root, found.directory);
					const entry: SkillEntry = {
						...parsed,
						directory,
						relativeDirectory: found.directory,
						file: found.file,
						source: source.source,
						location: source.location,
						files: source.files,
						...(source.env ? { env: source.env } : {}),
						shadowed: false,
						selected,
						indexed: false,
						estimatedTokens: 0,
					};
					const winner = winners.get(entry.name);
					if (winner) {
						entry.shadowed = true;
						entry.shadowedBy = winner.source;
					} else winners.set(entry.name, entry);
					skills.push(entry);
				} catch (error) {
					const issue = {
						source: source.source,
						path: fullFile,
						message: error instanceof Error ? error.message : String(error),
					};
					issues.push(issue);
					try {
						onIssue?.(issue);
					} catch {
						/* Reporting cannot interrupt prompt assembly. */
					}
				}
			}
		}
		const indexed = [...winners.values()]
			.filter((skill) => skill.selected && !skill.disableModelInvocation)
			.sort((a, b) => compare(a.name, b.name));
		for (const skill of indexed) skill.indexed = true;
		const index = indexed.length
			? `<skills>\n${indexed.map((skill) => `<skill name="${escapeXml(skill.name)}">${escapeXml(skill.description)}</skill>`).join("\n")}\n</skills>`
			: "";
		for (const skill of indexed)
			skill.estimatedTokens = Math.ceil(
				`<skill name="${escapeXml(skill.name)}">${escapeXml(skill.description)}</skill>`.length / 4,
			);
		return { skills, issues, index, estimatedTokens: Math.ceil(index.length / 4) };
	}
	async function inspect(session: RuntimeSessionConfig): Promise<SkillsReport> {
		const report = await inspectInternal(session);
		return {
			...report,
			skills: report.skills.map(
				({
					directory: _directory,
					relativeDirectory: _relativeDirectory,
					file: _file,
					files: _files,
					env: _env,
					...skill
				}) => skill,
			),
		};
	}

	async function readSkill(skill: SkillEntry, path?: string): Promise<ToolResult> {
		const target = resolve(skill.directory, path ?? "SKILL.md");
		if (!inside(resolve(skill.directory), target)) throw new Error("skill_view 路径超出 skill 目录");
		const canonicalRoot = skill.env ? await canonicalPath(skill.env, skill.directory) : await realpath(skill.directory);
		const canonicalTarget = skill.env ? await canonicalPath(skill.env, target) : await realpath(target);
		if (!inside(canonicalRoot, canonicalTarget)) throw new Error("skill_view 路径超出 skill 目录");
		const content = await skill.files.readFile(join(skill.relativeDirectory, relative(skill.directory, target)));
		return { text: `Skill directory: ${canonicalRoot}\nLocation: ${skill.location}\n\n${content}` };
	}

	async function view(session: RuntimeSessionConfig, name: string, path?: string): Promise<ToolResult> {
		if (session.resolved.skills.length === 0) throw new Error(`未找到当前配置档选中的 skill：${name}`);
		const report = await inspectInternal(session);
		const skill = report.skills.find(
			(candidate) => candidate.name === name && !candidate.shadowed && candidate.selected,
		);
		if (!skill) throw new Error(`未找到当前配置档选中的 skill：${name}`);
		return readSkill(skill, path);
	}
	async function show(session: RuntimeSessionConfig, name: string) {
		const report = await inspectInternal(session);
		const winner = report.skills.find((candidate) => candidate.name === name && !candidate.shadowed);
		if (!winner) throw new Error(`未找到 skill：${name}`);
		const { files: _files, env: _env, relativeDirectory: _relative, file: _file, ...skill } = winner;
		return {
			skill,
			shadowed: report.skills
				.filter((candidate) => candidate.name === name && candidate.shadowed)
				.map(({ files: _f, env: _e, relativeDirectory: _r, file: _p, ...info }) => info),
			content: (await readSkill(winner)).text,
		};
	}
	return {
		inspect,
		show,
		index: async (session: RuntimeSessionConfig) =>
			session.resolved.skills.length === 0 ? "" : (await inspectInternal(session)).index,
		view,
	};
}

export type Skills = ReturnType<typeof createSkills>;

export { addLocalSkill, type LocalSkillsTarget, removeLocalSkill } from "./manage.js";
