import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionEnv, ToolResult } from "@yonder/sdk";
import { parse } from "yaml";
import { matchesGlob, type WorkspaceFiles } from "../config/index.js";
import { canonicalPath } from "../runtime/env.js";
import type { RuntimeSessionConfig } from "../runtime/types.js";
import { addIgnoreRules, ignoreFileNames, ignored, type IgnoreRule } from "./ignore.js";

export type SkillSource = "workspace" | "home" | "agents" | "project-agents" | "project" | "builtin" | `plugin:${string}`;
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
	fileName: string;
	absoluteFile: string;
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
	/** OS user home; its `.agents/skills` is the user-level Agent Skills location, as in pi. */
	userHome?: string;
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

async function readIgnoreFiles(source: SkillFiles, rules: IgnoreRule[], path: string): Promise<void> {
	const prefix = path === "." ? "" : `${path.split(sep).join("/")}/`;
	for (const name of ignoreFileNames) {
		const file = path === "." ? name : join(path, name);
		if (!(await source.files.exists(file))) continue;
		try {
			addIgnoreRules(rules, await source.files.readFile(file), prefix);
		} catch {
			/* An unreadable ignore file never blocks skill discovery. */
		}
	}
}

/**
 * Discovery rules (copied from pi): a directory holding `SKILL.md` is a skill root and is not
 * descended into; the discovery root also accepts direct `.md` files; dot entries and
 * `node_modules` are skipped; `.gitignore`/`.ignore`/`.fdignore` are honoured.
 */
async function discover(source: SkillFiles): Promise<Array<{ file: string; directory: string }>> {
	const result: Array<{ file: string; directory: string }> = [];
	const rules: IgnoreRule[] = [];
	const visit = async (path: string, includeRootFiles: boolean): Promise<void> => {
		await readIgnoreFiles(source, rules, path);
		let entries: Awaited<ReturnType<WorkspaceFiles["list"]>>;
		try {
			entries = (await source.files.list(path)).sort((a, b) => compare(a.name, b.name));
		} catch {
			return;
		}
		const child = (name: string) => (path === "." ? name : join(path, name));
		const relativePath = (name: string) => child(name).split(sep).join("/");
		for (const entry of entries) {
			if (entry.name !== "SKILL.md" || entry.type === "directory") continue;
			if (ignored(rules, relativePath(entry.name), false)) continue;
			const file = child(entry.name);
			result.push({ file, directory: dirname(file) });
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const file = child(entry.name);
			const relPath = relativePath(entry.name);
			if (entry.type === "directory") {
				if (ignored(rules, relPath, true)) continue;
				await visit(file, false);
				continue;
			}
			if (!includeRootFiles || !entry.name.endsWith(".md") || entry.name === "SKILL.md") continue;
			if (ignored(rules, relPath, false)) continue;
			result.push({ file, directory: dirname(file) });
		}
	};
	if (await source.files.exists(source.base)) await visit(source.base, true);
	return result;
}

export interface SkillFrontmatter {
	name: string;
	description: string;
	disableModelInvocation: boolean;
	warnings: string[];
}

/**
 * Parses a skill file. Only a broken YAML frontmatter throws; an invalid name or description is a
 * warning and the skill still loads, matching pi and the Agent Skills specification.
 */
export function parseSkillFrontmatter(text: string, fallbackName = ""): SkillFrontmatter {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!match) throw new Error("缺少 YAML frontmatter");
	const data: unknown = parse(match[1]!);
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("frontmatter 必须是映射");
	const value = data as Record<string, unknown>;
	const warnings: string[] = [];
	const rawName = typeof value.name === "string" ? value.name.trim() : "";
	const name = rawName || fallbackName;
	if (!rawName && fallbackName) warnings.push(`缺少 name，回退为目录名：${fallbackName}`);
	if (!name) warnings.push("缺少 name，且没有可用的目录名");
	else if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
		warnings.push(`name 格式无效（需为最多 64 字符的小写字母、数字、连字符）：${name}`);
	const description = typeof value.description === "string" ? value.description : "";
	if (!description.trim()) warnings.push("description 必填且不得超过 1024 字符");
	else if (description.length > 1024) warnings.push(`description 超过 1024 字符（${description.length}）`);
	return {
		name,
		description,
		disableModelInvocation: value["disable-model-invocation"] === true,
		warnings,
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
const skillName = (absoluteFile: string, isDeclared: boolean) =>
	isDeclared ? basename(dirname(absoluteFile)) : basename(absoluteFile, ".md");

/** One `<skill>` element of the index; `location` is the absolute SKILL.md path, readable with the read tool. */
const indexEntry = (skill: SkillEntry) =>
	[
		"  <skill>",
		`    <name>${escapeXml(skill.name)}</name>`,
		`    <description>${escapeXml(skill.description)}</description>`,
		`    <location>${escapeXml(skill.absoluteFile)}</location>`,
		"  </skill>",
	].join("\n");

/** Project `.agents/skills` from the repository root down to the working directory, then `cwd/.pi/skills`. */
async function projectSkillDirs(cwd: string): Promise<Array<{ directory: string; source: SkillSource }>> {
	const chain: string[] = [];
	let current = resolve(cwd);
	let repositoryRoot: string | undefined;
	while (true) {
		chain.push(current);
		if (repositoryRoot === undefined && (await hostFiles(current).exists(".git"))) repositoryRoot = current;
		if (repositoryRoot !== undefined && current === repositoryRoot) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const dirs = chain
		.reverse()
		.map((directory) => ({ directory: join(directory, ".agents", "skills"), source: "project-agents" as const }));
	return [...dirs, { directory: join(resolve(cwd), ".pi", "skills"), source: "project" as const }];
}

export function createSkills({ home, userHome, pluginDirs, pluginSources, workspace, onIssue }: CreateSkillsOptions) {
	const sourceFor = async (session: RuntimeSessionConfig): Promise<SkillFiles[]> => {
		const workspaceSource = workspace?.(session);
		const project = await projectSkillDirs(session.cwd);
		return [
			...(workspaceSource ? [{ ...workspaceSource, base: "skills", source: "workspace" as const }] : []),
			...(userHome
				? [
						{
							root: join(userHome, ".agents"),
							base: "skills",
							source: "agents" as const,
							location: join(userHome, ".agents", "skills"),
							files: hostFiles(join(userHome, ".agents")),
						},
					]
				: []),
			{ root: home, base: "skills", source: "home", location: "home", files: hostFiles(home) },
			...project.map((entry) => ({
				root: entry.directory,
				base: ".",
				source: entry.source,
				location: entry.directory,
				files: hostFiles(entry.directory),
			})),
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

	async function canonical(source: SkillFiles, path: string): Promise<string> {
		try {
			return source.env ? await canonicalPath(source.env, path) : await realpath(path);
		} catch {
			return path;
		}
	}

	async function inspectInternal(
		session: RuntimeSessionConfig,
	): Promise<{ skills: SkillEntry[]; issues: SkillIssue[]; index: string; estimatedTokens: number }> {
		const issues: SkillIssue[] = [];
		const skills: SkillEntry[] = [];
		const winners = new Map<string, SkillEntry>();
		const seen = new Set<string>();
		const report = (issue: SkillIssue) => {
			issues.push(issue);
			try {
				onIssue?.(issue);
			} catch {
				/* Reporting cannot interrupt prompt assembly. */
			}
		};
		for (const source of await sourceFor(session)) {
			for (const found of await discover(source)) {
				const fullFile = join(source.root, found.file);
				const fallback = skillName(fullFile, basename(found.file) === "SKILL.md");
				let parsed: SkillFrontmatter;
				try {
					parsed = parseSkillFrontmatter(await source.files.readFile(found.file), fallback);
				} catch (error) {
					report({
						source: source.source,
						path: fullFile,
						message: error instanceof Error ? error.message : String(error),
					});
					continue;
				}
				if (!parsed.name || !parsed.description?.trim()) {
					for (const warning of parsed.warnings) report({ source: source.source, path: fullFile, message: warning });
					continue;
				}
				for (const warning of parsed.warnings) report({ source: source.source, path: fullFile, message: warning });
				const absoluteFile = await canonical(source, resolve(source.root, found.file));
				if (seen.has(absoluteFile)) continue;
				const selected =
					(session.resolved.skills ?? ["*"]).some((pattern) => matchesGlob(pattern, parsed.name!)) &&
					(session.resolved.delegationCeilings ?? []).every((ceiling) =>
						ceiling.skills.some((pattern) => matchesGlob(pattern, parsed.name!)),
					);
				const entry: SkillEntry = {
					name: parsed.name,
					description: parsed.description,
					disableModelInvocation: parsed.disableModelInvocation,
					directory: resolve(source.root, found.directory),
					relativeDirectory: found.directory,
					file: found.file,
					fileName: basename(found.file),
					absoluteFile,
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
					report({
						source: source.source,
						path: fullFile,
						message: `name 冲突：${entry.name} 已由 ${winner.absoluteFile} 提供，先到者胜`,
					});
				} else {
					winners.set(entry.name, entry);
					seen.add(absoluteFile);
				}
				skills.push(entry);
			}
		}
		const indexed = [...winners.values()]
			.filter((skill) => skill.selected && !skill.disableModelInvocation)
			.sort((a, b) => compare(a.name, b.name));
		for (const skill of indexed) skill.indexed = true;
		const entries = indexed.map(indexEntry);
		const index = entries.length ? `<available_skills>\n${entries.join("\n")}\n</available_skills>` : "";
		for (const [position, skill] of indexed.entries()) skill.estimatedTokens = Math.ceil(entries[position]!.length / 4);
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
					fileName: _fileName,
					absoluteFile: _absoluteFile,
					files: _files,
					env: _env,
					...skill
				}) => skill,
			),
		};
	}

	async function readSkill(skill: SkillEntry, path?: string): Promise<ToolResult> {
		const target = resolve(skill.directory, path ?? skill.fileName);
		if (!inside(resolve(skill.directory), target)) throw new Error("skill_view 路径超出 skill 目录");
		const canonicalRoot = skill.env ? await canonicalPath(skill.env, skill.directory) : await realpath(skill.directory);
		const canonicalTarget = skill.env ? await canonicalPath(skill.env, target) : await realpath(target);
		if (!inside(canonicalRoot, canonicalTarget)) throw new Error("skill_view 路径超出 skill 目录");
		const content = await skill.files.readFile(join(skill.relativeDirectory, relative(skill.directory, target)));
		return { text: `Skill directory: ${canonicalRoot}\nLocation: ${skill.location}\n\n${content}` };
	}

	async function selectedSkill(session: RuntimeSessionConfig, name: string): Promise<SkillEntry> {
		if (session.resolved.skills.length === 0) throw new Error(`未找到当前配置档选中的 skill：${name}`);
		const report = await inspectInternal(session);
		const skill = report.skills.find(
			(candidate) => candidate.name === name && !candidate.shadowed && candidate.selected,
		);
		if (!skill) throw new Error(`未找到当前配置档选中的 skill：${name}`);
		return skill;
	}

	async function view(session: RuntimeSessionConfig, name: string, path?: string): Promise<ToolResult> {
		return readSkill(await selectedSkill(session, name), path);
	}
	/**
	 * `/skill:<name> [request]` forces a skill to load: its file text, then the remaining text as the
	 * user request. Returns undefined for any other input.
	 */
	async function command(session: RuntimeSessionConfig, text: string): Promise<string | undefined> {
		const match = /^\/skill:([^\s/\\]+)(?:\s+([\s\S]*))?\s*$/.exec(text.trim());
		if (!match) return undefined;
		const body = await view(session, match[1]!);
		const request = match[2]?.trim() ?? "";
		return request ? `${body.text}\n\n${request}` : body.text;
	}
	async function show(session: RuntimeSessionConfig, name: string) {
		const report = await inspectInternal(session);
		const winner = report.skills.find((candidate) => candidate.name === name && !candidate.shadowed);
		if (!winner) throw new Error(`未找到 skill：${name}`);
		const {
			files: _files,
			env: _env,
			relativeDirectory: _relative,
			file: _file,
			fileName: _fileName,
			absoluteFile: _absoluteFile,
			...skill
		} = winner;
		return {
			skill,
			shadowed: report.skills
				.filter((candidate) => candidate.name === name && candidate.shadowed)
				.map(({ files: _f, env: _e, relativeDirectory: _r, file: _p, fileName: _n, absoluteFile: _a, ...info }) => info),
			content: (await readSkill(winner)).text,
		};
	}
	return {
		inspect,
		show,
		command,
		index: async (session: RuntimeSessionConfig) =>
			session.resolved.skills.length === 0 ? "" : (await inspectInternal(session)).index,
		view,
	};
}

export type Skills = ReturnType<typeof createSkills>;

export { addLocalSkill, type LocalSkillsTarget, removeLocalSkill } from "./manage.js";
