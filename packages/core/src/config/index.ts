import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type Capability,
	intersectChannelInstances,
	type Level,
	type Preset,
	type Profile,
	type SessionModels,
} from "@yonder/sdk";
import type { Static, TSchema } from "typebox";
import { Errors } from "typebox/value";
import { parseDocument } from "yaml";
import { promptSectionIds } from "../prompt/content.js";
import {
	defaultBudget,
	defaultModelChain,
	defaultOutsiders,
	defaultPriceCapPerMTokenYuan,
	socialWithDefaults,
} from "./defaults.js";
import {
	type AgentConfig,
	AgentSchema,
	type Binding,
	PresetSchema,
	type YonderConfig,
	YonderSchema,
} from "./schema.js";
import { loadSubagentDefinitions } from "./subagent-definitions.js";

export { tokenAmount } from "./defaults.js";
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

export type ResolvedProfile = Required<
	Omit<Profile, "level" | "tools" | "limits" | "fallback" | "channelInstances">
> & {
	level?: Level;
	channelInstances?: string[];
	fallback?: Profile["fallback"];
	tools: Required<NonNullable<Profile["tools"]>>;
	limits: Required<NonNullable<Profile["limits"]>>;
	delegationCeilings?: DelegationCeiling[];
};

const levels: Record<Level, Capability[]> = {
	bypass: ["read", "write", "exec", "network", "message", "cross-agent", "admin"],
	standard: ["read", "write", "exec", "network", "message"],
	readonly: ["read"],
};
export const defaultLimits = {
	maxTurns: 100,
	maxMinutes: 30,
	stuckMinutes: 60,
	maxTokens: 200000,
	repeatBlock: 3,
	repeatStop: 5,
};

/** Each layer overrides only the providers it names; "default" is an explicit selection, not absence. */
export function mergeCredentialSlots(
	...layers: Array<SessionModels["credentialSlots"]>
): NonNullable<SessionModels["credentialSlots"]> {
	return Object.fromEntries(layers.flatMap((layer) => Object.entries(layer ?? {})));
}

/** Level and capabilities depend on no model, so permission checks need no configured default model. */
function securityOf(profile: Profile, defaults: Profile): { level?: Level; capabilities: Capability[] } {
	const security = profile.level !== undefined || profile.capabilities !== undefined ? profile : defaults;
	const level = security.capabilities === undefined ? (security.level ?? "readonly") : undefined;
	return { level, capabilities: [...(security.capabilities ?? levels[level ?? "readonly"])] } as {
		level?: Level;
		capabilities: Capability[];
	};
}

/**
 * `defaultModel` is yonder.yaml's global default model; a profile's own model, then the agent defaults', win.
 * With none of the three there is no model to run, so fail naming the field (spec 08 §2).
 */
export function resolveProfile(
	profile: Profile,
	defaults: Profile = {},
	workspaceEnv = "local",
	defaultModel?: string,
): ResolvedProfile {
	const model = profile.model ?? defaults.model ?? defaultModel;
	if (model === undefined)
		throw new ConfigError([
			{
				file: "yonder.yaml",
				path: "/defaultModel",
				message: "未配置默认模型：请在 yonder.yaml 设置 defaultModel（格式 provider/modelId）",
			},
		]);
	const { level, capabilities } = securityOf(profile, defaults);
	return {
		thinking: "medium",
		plugins: [],
		contexts: [],
		skills: ["*"],
		instructions: "",
		env: workspaceEnv,
		...defaults,
		...profile,
		model,
		credentialSlots: mergeCredentialSlots(defaults.credentialSlots, profile.credentialSlots),
		level,
		capabilities,
		tools: { offer: ["*"], search: [], ...defaults.tools, ...profile.tools },
		limits: { ...defaultLimits, ...defaults.limits, ...profile.limits },
		prompt: { ...defaults.prompt, ...profile.prompt },
	} as ResolvedProfile;
}

export type PresetInherit = {
	plugins: string[];
	tools: { offer: string[]; search: string[] };
	skills?: string[];
	ceilings?: DelegationCeiling[];
	explicitSessionTools?: boolean;
};

export type DelegationCeiling = {
	tools: { offer: string[]; search: string[] };
	skills: string[];
	explicitSessionTools: boolean;
};

/**
 * Capabilities and inherited tool surface for a preset session (spec 03 §4). A preset that sets no
 * level/capabilities takes the opener's; one that sets them is intersected with the opener. Nothing
 * ever exceeds the opener, or the limit a plugin caller passes.
 */
export function presetSession(
	preset: Profile,
	env: string,
	opener?: ResolvedProfile,
	limit?: Capability[],
	openerAgent?: string | null,
): { capabilities: Capability[]; channelInstances?: string[]; inherit?: PresetInherit } {
	const own = preset.level !== undefined || preset.capabilities !== undefined;
	const ceiling = opener?.capabilities;
	const base = own || !(ceiling ?? limit) ? securityOf(preset, {}).capabilities : [...(ceiling ?? limit!)];
	const capabilities = base.filter(
		(capability) => (ceiling ?? base).includes(capability) && (!limit || limit.includes(capability)),
	);
	const channelInstances = intersectChannelInstances(opener?.channelInstances, preset.channelInstances);
	return {
		capabilities,
		...(channelInstances === undefined ? {} : { channelInstances }),
		...(opener
			? {
					inherit: {
						plugins: [...opener.plugins],
						tools: { offer: [...opener.tools.offer], search: [...opener.tools.search] },
						skills: [...opener.skills],
						ceilings: structuredClone(opener.delegationCeilings ?? []),
						explicitSessionTools: openerAgent != null && openerAgent !== "main",
					},
				}
			: {}),
	};
}

/** The profile a preset session runs with: what the preset sets, plus the opener's plugins and tools where it sets none. */
export function presetProfile(
	preset: Profile,
	env: string,
	capabilities?: Capability[],
	inherit?: PresetInherit,
	channelInstances?: string[],
	defaultModel?: string,
): ResolvedProfile {
	const resolved = resolveProfile(preset, {}, env, defaultModel);
	const scope = intersectChannelInstances(channelInstances, resolved.channelInstances);
	if (scope !== undefined) resolved.channelInstances = scope;
	const inherited = inherit
		? {
				...resolved,
				plugins: (preset.plugins ?? inherit.plugins).filter((plugin) => inherit.plugins.includes(plugin)),
				tools: {
					offer: preset.tools?.offer ?? inherit.tools.offer,
					search: preset.tools?.search ?? inherit.tools.search,
				},
				skills: preset.skills ?? inherit.skills ?? [],
				delegationCeilings: [
					...(inherit.ceilings ?? []),
					{
						tools: inherit.tools,
						skills: inherit.skills ?? [],
						explicitSessionTools: inherit.explicitSessionTools ?? true,
					},
				],
			}
		: resolved;
	if (!capabilities) return inherited;
	const { level: _level, ...effective } = inherited;
	return { ...effective, capabilities: presetSession(preset, env, undefined, capabilities).capabilities };
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
	if (
		value !== null &&
		typeof value === "object" &&
		"version" in value &&
		typeof value.version === "number" &&
		value.version > 1
	)
		throw new ConfigError([
			{ file, path: "/version", message: `配置版本 ${value.version} 高于本程序支持的 1，请升级 Yonder` },
		]);
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

export function promptErrors(prompt: Profile["prompt"]): string[] {
	const selected = prompt?.sections ?? [];
	const ids = [...selected, ...Object.keys(prompt?.overrides ?? {})];
	return [
		...new Set(ids.filter((id) => !promptSectionIds.includes(id)).map((id) => `Unknown prompt section: ${id}`)),
		...(new Set(selected).size !== selected.length ? ["Duplicate prompt section"] : []),
	];
}

function profileIssues(profile: Profile, file: string, path: string): ConfigIssue[] {
	return [
		...(profile.level !== undefined && profile.capabilities !== undefined
			? [{ file, path, message: "level 与 capabilities 只能选择一个" }]
			: []),
		...promptErrors(profile.prompt).map((message) => ({ file, path: `${path}/prompt`, message })),
	];
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

function publicAvatarUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.port &&
			/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) &&
			!/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$|\.home\.arpa$/i.test(url.hostname)
		);
	} catch {
		return false;
	}
}

export function parseAgentConfig(text: string, file = "agent.yaml", expectedId?: string): AgentConfig {
	const agent = parse(text, file, AgentSchema);
	const issues = profileIssues(agent.defaults ?? {}, file, "/defaults");
	if (agent.avatarUrl !== undefined && !publicAvatarUrl(agent.avatarUrl))
		issues.push({ file, path: "/avatarUrl", message: "必须为无凭据的公共域名 HTTPS 图片 URL" });
	if (expectedId !== undefined && agent.id !== expectedId)
		issues.push({ file, path: "/id", message: "必须等于 yonder.yaml 登记的 agent id" });
	if (!(agent.defaultProfile in agent.profiles))
		issues.push({ file, path: "/defaultProfile", message: "配置档不存在" });
	for (const [name, profile] of Object.entries(agent.profiles))
		issues.push(...profileIssues(profile, file, `/profiles/${name}`));
	const seen = new Set<string>();
	for (const [index, binding] of agent.bindings.entries()) {
		const path = `/bindings/${index}`;
		if (binding.id === "@console")
			issues.push({ file, path: `${path}/id`, message: "绑定 id @console 为内置控制台入口保留" });
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
	const policies = [
		...Object.entries(agent.social?.defaults ?? {}).map(
			([key, policy]) => [`/social/defaults/${key}`, policy] as const,
		),
		...Object.entries(agent.social?.conversations ?? {}).map(
			([key, policy]) => [`/social/conversations/${key}`, policy] as const,
		),
	];
	for (const [path, policy] of policies) {
		if (!policy) continue;
		if (
			(path.endsWith("/dm") && policy.mode && !["direct", "record", "mute"].includes(policy.mode)) ||
			((path.endsWith("/group") || path.endsWith("/channel")) && policy.mode === "direct")
		)
			issues.push({ file, path: `${path}/mode`, message: "不支持的会话模式" });
		if (policy.quiet) {
			if (policy.quiet.start === policy.quiet.end)
				issues.push({ file, path: `${path}/quiet`, message: "开始和结束不能相同" });
			try {
				new Intl.DateTimeFormat("en", { timeZone: policy.quiet.timezone });
			} catch {
				issues.push({ file, path: `${path}/quiet/timezone`, message: "无效的 IANA 时区" });
			}
		}
	}
	const subjects = new Set<string>();
	for (const [index, mapping] of (agent.social?.mappings ?? []).entries()) {
		if (subjects.has(mapping.subject))
			issues.push({ file, path: `/social/mappings/${index}/subject`, message: "映射主体重复" });
		subjects.add(mapping.subject);
		if (mapping.agent === agent.id && !(mapping.profile in agent.profiles))
			issues.push({ file, path: `/social/mappings/${index}/profile`, message: "配置档不存在" });
	}
	if (issues.length) throw new ConfigError(issues);
	return agent.social ? { ...agent, social: socialWithDefaults(agent.social) } : agent;
}

export function parsePresetConfig(text: string, id: string, file = `${id}.yaml`): Preset {
	const { schema: _, ...preset } = parse(text, file, PresetSchema);
	const issues = profileIssues(preset, file, "/");
	if (issues.length) throw new ConfigError(issues);
	return { id, ...preset };
}

/**
 * Homes created before `defaultModel` existed always register agents and never name the field; their
 * model-less presets resolved to this model, so absence in such a home keeps it (docs/decisions.md).
 * Every home created since writes `defaultModel` explicitly.
 */
const legacyDefaultModel = "openai/gpt-6-luna";

export function parseYonderConfig(text: string, file: string): YonderConfig {
	const parsed = parse(text, file, YonderSchema);
	const legacy = parsed.defaultModel === undefined && (parsed.agents?.length ?? 0) > 0;
	const config: YonderConfig = {
		...parsed,
		...(legacy ? { defaultModel: legacyDefaultModel } : {}),
		locale: parsed.locale ?? "zh-CN",
		timezone: parsed.timezone ?? "Asia/Shanghai",
		models: {
			...parsed.models,
			chain: parsed.models?.chain ?? [...defaultModelChain],
			priceCapPerMTokenYuan: parsed.models?.priceCapPerMTokenYuan ?? defaultPriceCapPerMTokenYuan,
		},
		budget: { ...defaultBudget, ...parsed.budget },
		outsiders: { ...defaultOutsiders, ...parsed.outsiders },
		defaults: { channelPolicy: parsed.defaults?.channelPolicy ?? "open" },
	};
	const issues: ConfigIssue[] = [];
	try {
		new Intl.DateTimeFormat(config.locale);
	} catch {
		issues.push({ file, path: "/locale", message: "locale: invalid Intl locale" });
	}
	try {
		new Intl.DateTimeFormat("en", { timeZone: config.timezone });
	} catch {
		issues.push({ file, path: "/timezone", message: "timezone: invalid IANA timezone" });
	}
	const quiet = config.notifications?.outbound?.quiet;
	if (quiet) {
		if (quiet.start === quiet.end)
			issues.push({ file, path: "/notifications/outbound/quiet", message: "开始和结束不能相同" });
		try {
			new Intl.DateTimeFormat("en", { timeZone: quiet.timezone });
		} catch {
			issues.push({ file, path: "/notifications/outbound/quiet/timezone", message: "无效的 IANA 时区" });
		}
	}
	const target = config.notifications?.outbound?.target;
	if (
		target &&
		(target.to.split(":")[1] !== target.via || (target.via !== "console" && !config.channels?.[target.via]))
	)
		issues.push({ file, path: "/notifications/outbound/target", message: "目标实例不存在或与目标引用不一致" });
	if (config.channels?.agent) issues.push({ file, path: "/channels/agent", message: "agent 渠道保留给内核" });
	if (issues.length) throw new ConfigError(issues);
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
	for (const [id, definition] of await loadSubagentDefinitions(home)) presets.set(id, definition);
	return presets;
}
