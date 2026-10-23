import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Models, Preset, SessionInfo } from "@yonder/sdk";
import { stringify } from "yaml";
import {
	type AgentConfig,
	loadPresets,
	loadYonderConfig,
	promptErrors,
	resolveProfile,
	type YonderConfig,
} from "../config/index.js";
import { type LoadedPlugins, loadPlugins } from "../plugins/index.js";
import { scaffoldWorkspace } from "../prompt/index.js";
import { filesFor, inspectionServices, loadAgents, message, profileFor, skillsFor } from "./workspace.js";

export function protectSessions(
	config: YonderConfig,
	candidate: YonderConfig,
	agents: Map<string, AgentConfig>,
	nextAgents: Map<string, AgentConfig>,
	presets: Map<string, Preset>,
	nextPresets: Map<string, Preset>,
	sessions: SessionInfo[],
	errors: string[],
) {
	for (const session of sessions) {
		if (session.agent) {
			const before = config.agents?.find((a) => a.id === session.agent),
				after = candidate.agents?.find((a) => a.id === session.agent);
			if (!nextAgents.get(session.agent)?.profiles[session.profile])
				errors.push(`session ${session.id}: close session before removing agent/profile ${session.profile}`);
			const previous = agents.get(session.agent),
				next = nextAgents.get(session.agent);
			const oldProfile = previous?.profiles[session.profile],
				newProfile = next?.profiles[session.profile];
			const envChanged =
				oldProfile &&
				newProfile &&
				resolveProfile(oldProfile, previous?.defaults, before?.env).env !==
					resolveProfile(newProfile, next?.defaults, after?.env).env;
			if (before?.workspace !== after?.workspace || before?.env !== after?.env || envChanged)
				errors.push(`session ${session.id}: close before changing workspace/env`);
		} else if (presets.has(session.profile) && !nextPresets.has(session.profile))
			errors.push(`session ${session.id}: close session before removing preset ${session.profile}`);
	}
	for (const id of agents.keys()) if (!nextAgents.has(id)) errors.push(`agent ${id}: archive instead of unregistering`);
}

export function configurationErrors(
	config: YonderConfig,
	agents: Map<string, AgentConfig>,
	plugins: LoadedPlugins,
	models: Models,
	presets: Map<string, Preset>,
): string[] {
	const errors: string[] = [];
	const validateProfile = (name: string, selected: ReturnType<typeof resolveProfile>) => {
		errors.push(...promptErrors(selected.prompt).map((error) => `${name}: ${error}`));
		for (const ref of [selected.model, ...(selected.fallback?.models ?? [])]) {
			const slash = ref.indexOf("/");
			if (!models.getModel(ref.slice(0, slash), ref.slice(slash + 1))) errors.push(`${name}: unknown model ${ref}`);
		}
		if (selected.env !== "local" && !plugins.envs.has(selected.env))
			errors.push(`${name}: unknown environment ${selected.env}`);
		for (const id of selected.contexts) if (!plugins.contexts.has(id)) errors.push(`${name}: unknown context ${id}`);
		for (const id of selected.plugins) if (!plugins.tools.has(id)) errors.push(`${name}: unknown plugin ${id}`);
	};
	for (const agent of agents.values()) {
		if (agent.archivedAt) continue;

		for (const [name, profile] of Object.entries(agent.profiles)) {
			const selected = resolveProfile(
				profile,
				agent.defaults,
				config.agents?.find((item) => item.id === agent.id)?.env,
			);
			validateProfile(`${agent.id}/${name}`, selected);
		}
		for (const binding of agent.bindings) {
			const ids =
				binding.match.channel === undefined ? [...plugins.channels.keys(), "agent"] : [binding.match.channel].flat();
			const kinds = binding.match.kind === undefined ? [] : [binding.match.kind].flat();
			for (const id of ids) {
				const supported = id === "agent" ? ["agent", "parent-request"] : plugins.channels.get(id)?.kinds;
				if (!supported) {
					errors.push(`${agent.id}/${binding.id}: unknown channel ${id}`);
				}
			}
			for (const kind of kinds)
				if (
					!ids.some((id) =>
						(id === "agent" ? ["agent", "parent-request"] : plugins.channels.get(id)?.kinds)?.includes(kind),
					)
				)
					errors.push(`${agent.id}/${binding.id}: no selected channel declares kind ${kind}`);
		}
	}
	for (const [id, preset] of presets) validateProfile(`preset:${id}`, resolveProfile(preset));
	return errors;
}

export async function initHome(home: string, owner = "owner") {
	home = resolve(home);
	const directory = join(home, "agents/main");
	await mkdir(directory, { recursive: true });
	const config: YonderConfig = {
		schema: 1,
		locale: "zh-CN",
		timezone: "Asia/Shanghai",
		plugins: [
			{ use: "@yonder/plugin-channel-cli" },
			{ use: "@yonder/plugin-context-files" },
			{ use: "@yonder/plugin-ui-companion" },
			{ use: "@yonder/plugin-agent-presets" },
		],
		channels: { cli: { type: "cli" } },
		envs: { local: { type: "local" } },
		agents: [{ id: "main", workspace: "./agents/main" }],
		identity: { persons: [{ id: owner, name: owner, accounts: ["acct:cli:local"] }] },
	};
	await writeFile(join(home, "yonder.yaml"), stringify(config), { flag: "wx" });
	await mkdir(join(home, "presets"), { recursive: true });
	await writeFile(
		join(home, "presets/default.yaml"),
		stringify({
			schema: 1,
			description: "独立任务 · Standalone task",
			model: "openai/gpt-6-luna",
			level: "standard",
			tools: { offer: ["*"] },
			plugins: [],
			contexts: [],
		}),
		{ flag: "wx" },
	);
	const agent: AgentConfig = {
		schema: 1,
		id: "main",
		name: "Jarvis",
		owner: `person:${owner}`,
		defaultProfile: "owner",
		defaults: {
			model: "openai/gpt-6-luna",
			contexts: ["jarvis-soul", "jarvis-work"],
			plugins: ["context-files", "agent-presets"],
		},
		profiles: { owner: { level: "bypass", tools: { offer: ["*"] } } },
		bindings: [
			{
				id: "owner",
				match: { channel: "cli", kind: "dm", from: "owner" },
				session: "main",
				profile: "owner",
				stream: true,
			},
		],
	};
	await writeFile(join(directory, "agent.yaml"), stringify(agent), { flag: "wx" });
	const plugins = await loadPlugins(
		home,
		config,
		inspectionServices(home, config, () => {}),
	);
	await scaffoldWorkspace(
		filesFor(home, config, plugins, "main"),
		profileFor(home, config, agent).resolved.contexts,
		plugins.contexts,
	);
	return { home, agent: "main", model: "openai/gpt-6-luna" };
}

export async function inspectHome(home: string): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
	const warnings = ["exec 可运行任意程序；主机中的 yonder CLI 等同于管理权限。文件能力规则不构成沙箱。"];
	try {
		const config = await loadYonderConfig(home);
		const services = inspectionServices(home, config, (level, text) => {
			if (level !== "info") warnings.push(text);
		});
		const plugins = await loadPlugins(home, config, services);
		const agents = await loadAgents(home, config, plugins);
		const presets = await loadPresets(home);
		const errors = configurationErrors(
			config,
			agents,
			plugins,
			services.models,
			new Map([...plugins.presets, ...presets]),
		);
		const skills = skillsFor(home, config, plugins, () => {});
		for (const agent of agents.values())
			for (const profile of Object.keys(agent.profiles)) {
				const report = await skills.inspect(profileFor(home, config, agent, profile));
				warnings.push(...report.issues.map((issue) => `${issue.path}: ${issue.message}`));
				warnings.push(
					...report.skills
						.filter((skill) => skill.shadowed)
						.map((skill) => `${skill.name}: ${skill.source} shadowed by ${skill.shadowedBy}`),
				);
				if (report.estimatedTokens > 4000)
					warnings.push(
						`${agent.id}/${profile}: skill index exceeds 4000 estimated tokens (${report.estimatedTokens})`,
					);
			}
		return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)] };
	} catch (error) {
		return { ok: false, errors: [message(error)], warnings };
	}
}
