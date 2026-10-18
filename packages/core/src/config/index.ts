import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Capability, Level, Preset, Profile } from "@yonder/sdk";
import type { Static, TSchema } from "typebox";
import { Errors } from "typebox/value";
import { parseDocument } from "yaml";
import {
	type AgentConfig,
	AgentSchema,
	type Binding,
	PresetSchema,
	type YonderConfig,
	YonderSchema,
} from "./schema.js";

export { watchConfig } from "./reload.js";
export type { AgentConfig, Binding, YonderConfig } from "./schema.js";

export interface WorkspaceFiles {
	readFile(path: string): Promise<string>;
	writeFile(path: string, text: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	list(path: string): Promise<Array<{ name: string; type: "file" | "directory" | "symlink" }>>;
}

export interface ConfigIssue {
	file: string;
	path: string;
	message: string;
}
export class ConfigError extends Error {
	constructor(public readonly issues: ConfigIssue[]) {
		super(issues.map(({ file, path, message }) => `${file}:${path}: ${message}`).join("\n"));
		this.name = "ConfigError";
	}
}

export type ResolvedProfile = Required<Omit<Profile, "level" | "tools" | "limits">> & {
	level?: Level;
	tools: Required<NonNullable<Profile["tools"]>>;
	limits: Required<NonNullable<Profile["limits"]>>;
};

const levels: Record<Level, Capability[]> = {
	bypass: ["read", "write", "exec", "network", "message", "cross-agent", "admin"],
	standard: ["read", "write", "exec", "network", "message"],
	readonly: ["read"],
};
export const defaultLimits = { maxTurns: 100, maxMinutes: 30, repeatBlock: 3, repeatStop: 5 };

export function resolveProfile(profile: Profile, defaults: Profile = {}, workspaceEnv = "local"): ResolvedProfile {
	const security = profile.level !== undefined || profile.capabilities !== undefined ? profile : defaults;
	const level = security.capabilities === undefined ? (security.level ?? "readonly") : undefined;
	return {
		model: "openai/gpt-6-luna",
		thinking: "medium",
		plugins: [],
		contexts: [],
		skills: ["*"],
		instructions: "",
		env: workspaceEnv,
		...defaults,
		...profile,
		level,
		capabilities: [...(security.capabilities ?? levels[level ?? "readonly"])],
		tools: { offer: ["*"], search: [], ...defaults.tools, ...profile.tools },
		limits: { ...defaultLimits, ...defaults.limits, ...profile.limits },
	} as ResolvedProfile;
}

export function matchesGlob(pattern: string, value: string): boolean {
	return new RegExp(
		`^${pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replaceAll("*", ".*")
			.replaceAll("?", ".")}$`,
		"u",
	).test(value);
}

function parse<T extends TSchema>(text: string, file: string, schema: T): Static<T> {
	const document = parseDocument(text, { prettyErrors: false });
	if (document.errors.length)
		throw new ConfigError(document.errors.map(({ message }) => ({ file, path: "/", message })));
	const value: unknown = document.toJS();
	const issues = Errors(schema, value).map((error) => ({
		file,
		path: error.instancePath || "/",
		message:
			error.instancePath === "/schema"
				? "schema 必须为 1；请先查看对应版本的迁移说明（docs/spec/08-config.md）"
				: error.message,
	}));
	if (issues.length) throw new ConfigError(issues);
	return value as Static<T>;
}

function securityIssues(profile: Profile, file: string, path: string): ConfigIssue[] {
	return profile.level !== undefined && profile.capabilities !== undefined
		? [{ file, path, message: "level 与 capabilities 只能选择一个" }]
		: [];
}

const intersects = (a?: string | string[], b?: string | string[]) =>
	a === undefined ||
	b === undefined ||
	(Array.isArray(a) ? a : [a]).some((value) => (Array.isArray(b) ? b : [b]).includes(value));

function sameSession(a: Binding, b: Binding): boolean {
	if (a.session === "main" || b.session === "main") return a.session === b.session;
	if (typeof a.session === "string" || typeof b.session === "string" || a.session.per !== b.session.per) return false;
	return (
		a.session.per === "person" ||
		(intersects(a.match.channel, b.match.channel) && intersects(a.match.kind, b.match.kind))
	);
}

export function parseAgentConfig(text: string, file = "agent.yaml", expectedId?: string): AgentConfig {
	const agent = parse(text, file, AgentSchema);
	const issues = securityIssues(agent.defaults ?? {}, file, "/defaults");
	if (expectedId !== undefined && agent.id !== expectedId)
		issues.push({ file, path: "/id", message: "必须等于 yonder.yaml 登记的 agent id" });
	if (!(agent.defaultProfile in agent.profiles))
		issues.push({ file, path: "/defaultProfile", message: "配置档不存在" });
	for (const [name, profile] of Object.entries(agent.profiles))
		issues.push(...securityIssues(profile, file, `/profiles/${name}`));
	const seen = new Set<string>();
	for (const [index, binding] of agent.bindings.entries()) {
		const path = `/bindings/${index}`;
		if (seen.has(binding.id)) issues.push({ file, path: `${path}/id`, message: "绑定 id 重复" });
		seen.add(binding.id);
		if (!((binding.profile ?? agent.defaultProfile) in agent.profiles))
			issues.push({ file, path: `${path}/profile`, message: "配置档不存在" });
		if (binding.session === "ephemeral" && (binding.wake ?? "run") !== "run")
			issues.push({ file, path: `${path}/wake`, message: "ephemeral 绑定的 wake 必须为 run" });
		// ponytail: pairwise checks suit small binding tables; index session scopes if these tables grow.
		for (const previous of agent.bindings.slice(0, index)) {
			if (
				sameSession(binding, previous) &&
				(binding.profile ?? agent.defaultProfile) !== (previous.profile ?? agent.defaultProfile)
			) {
				issues.push({
					file,
					path: `${path}/profile`,
					message: `可能与绑定 ${previous.id} 进入同一会话，必须使用同一配置档`,
				});
			}
		}
	}
	if (issues.length) throw new ConfigError(issues);
	return agent;
}

export function parsePresetConfig(text: string, id: string, file = `${id}.yaml`): Preset {
	const { schema: _, ...preset } = parse(text, file, PresetSchema);
	const issues = securityIssues(preset, file, "/");
	if (issues.length) throw new ConfigError(issues);
	return { id, ...preset };
}

export function parseYonderConfig(text: string, file: string): YonderConfig {
	const config = parse(text, file, YonderSchema);
	if (config.channels?.agent)
		throw new ConfigError([{ file, path: "/channels/agent", message: "agent 渠道保留给内核" }]);
	return config;
}

export async function loadYonderConfig(home: string): Promise<YonderConfig> {
	const file = join(home, "yonder.yaml");
	return parseYonderConfig(await readFile(file, "utf8"), file);
}

export async function loadAgentConfig(files: WorkspaceFiles, expectedId: string): Promise<AgentConfig> {
	return parseAgentConfig(await files.readFile("agent.yaml"), "agent.yaml", expectedId);
}

export async function presetFiles(home: string): Promise<string[]> {
	try {
		return (await readdir(join(home, "presets"), { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export async function loadPresets(home: string): Promise<Map<string, Preset>> {
	const presets = new Map<string, Preset>();
	const issues: ConfigIssue[] = [];
	for (const name of await presetFiles(home)) {
		const file = join(home, "presets", name);
		try {
			const id = name.slice(0, -5);
			presets.set(id, parsePresetConfig(await readFile(file, "utf8"), id, file));
		} catch (error) {
			if (!(error instanceof ConfigError)) throw error;
			issues.push(...error.issues);
		}
	}
	if (issues.length) throw new ConfigError(issues);
	return presets;
}
