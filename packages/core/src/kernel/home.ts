import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Models, Preset, SessionInfo } from "@yonder/sdk";
import { stringify } from "yaml";
import { bundleFor } from "../bundles.js";
import {
	type AgentConfig,
	loadPresets,
	loadYonderConfig,
	promptErrors,
	resolveProfile,
	type YonderConfig,
} from "../config/index.js";
import { socialReferenceErrors } from "../config/social-validation.js";
import { type LoadedPlugins, loadPlugins } from "../plugins/index.js";
import { scaffoldWorkspace } from "../prompt/index.js";
import { chainKey, modelChain } from "../runtime/model-chain.js";
import { ModelGate } from "../runtime/model-gate.js";
import { ModelHealth } from "../runtime/model-health.js";
import { accountKey, ModelQuota } from "../runtime/model-quota.js";
import { canReceivePeerAsk, peerFix, withDefaultPeer } from "./peer.js";
import { filesFor, inspectionServices, loadAgents, message, profileFor, skillsFor } from "./workspace.js";

/** Distinct contexts of every profile of an agent, resolved against the home's default model. */
export function profileContexts(agent: AgentConfig, defaultModel?: string): string[] {
	const contexts = Object.values(agent.profiles).flatMap(
		(profile) => resolveProfile(profile, agent.defaults, "local", defaultModel).contexts,
	);
	return [...new Set(contexts)];
}

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
				resolveProfile(oldProfile, previous?.defaults, before?.env, config.defaultModel).env !==
					resolveProfile(newProfile, next?.defaults, after?.env, candidate.defaultModel).env;
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
	const errors: string[] = socialReferenceErrors(config, agents);
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
				config.defaultModel,
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
	for (const [id, preset] of presets)
		validateProfile(`preset:${id}`, resolveProfile(preset, {}, "local", config.defaultModel));
	return errors;
}

export async function initHome(
	home: string,
	owner = "owner",
	options: { isolated?: boolean; bundle?: string; model?: string } = {},
) {
	if (options.isolated !== undefined && typeof options.isolated !== "boolean")
		throw new Error("isolated must be a boolean");
	const bundle = bundleFor(options.bundle ?? "default");
	if (!options.model)
		throw new Error("未指定默认模型：请用 --model <provider/modelId> 初始化，它会写入 yonder.yaml 的 defaultModel");
	home = resolve(home);
	const directory = join(home, "agents/main");
	await mkdir(directory, { recursive: true });
	const config: YonderConfig = {
		schema: 1,
		locale: "zh-CN",
		timezone: "Asia/Shanghai",
		...(options.model ? { defaultModel: options.model } : {}),
		plugins: bundle.plugins.map(({ use, config }) => ({
			use,
			...(config ? { config: config({ home, owner, timezone: "Asia/Shanghai" }) } : {}),
		})),
		channels: bundle.channels,
		envs: { local: { type: "local" } },
		agents: [{ id: "main", workspace: "./agents/main" }],
		identity: {
			persons: [
				{
					id: owner,
					name: owner,
					accounts: Object.keys(bundle.channels).includes("cli") ? ["acct:cli:local"] : [],
				},
			],
		},
	};
	await writeFile(join(home, "yonder.yaml"), stringify(config), { flag: "wx" });
	await mkdir(join(home, "presets"), { recursive: true });
	// 管家（design §5.2/§5.3）：发行包带 onboarding 且它服务的 agent 就是 main 时，main 选入它与 tasks，
	// 并由该插件写的 onboarding.start（conv:onboarding:<agent>）唤醒。
	const entry = config.plugins?.find((plugin) => plugin.use === "@yonder/plugin-onboarding");
	const butler = (entry?.config as { agent?: string } | undefined)?.agent ?? "main";
	const onboarding = !!entry && butler === "main";
	const agent: AgentConfig = withDefaultPeer(
		{
			schema: 1,
			id: "main",
			name: "Jarvis",
			owner: `person:${owner}`,
			defaultProfile: "owner",
			defaults: {
				contexts: ["jarvis-soul", "jarvis-work"],
				plugins: ["context-files", "agent-presets", "learning", ...(onboarding ? ["tasks", "onboarding"] : [])],
			},
			profiles: { owner: { level: "bypass", tools: { offer: ["*"] } } },
			// 没有 cli 渠道实例的发行包（core）不写这条绑定，否则配置校验会报 unknown channel cli。
			bindings: [
				...(bundle.channels.cli
					? [
							{
								id: "owner",
								match: { channel: "cli", kind: "dm", from: "owner" },
								session: "main" as const,
								profile: "owner",
								stream: true,
							},
						]
					: []),
				// isolated 保守拒绝任何不限渠道的绑定（peer.ts canReceivePeerAsk），此时由主人主动要求继续引导。
				...(onboarding && !options.isolated
					? [
							{
								id: "onboarding",
								match: { type: "onboarding.start", conv: `conv:onboarding:${butler}` },
								session: "main" as const,
								profile: "owner",
							},
						]
					: []),
			],
		},
		options.isolated,
		"local",
		config.defaultModel,
	);
	await writeFile(join(directory, "agent.yaml"), stringify(agent), { flag: "wx" });
	const plugins = await loadPlugins(
		home,
		config,
		inspectionServices(home, config, () => {}),
	);
	for (const name of ["default", "research"]) {
		const preset = plugins.presets.get(name);
		if (!preset) throw new Error(`Missing official preset ${name}`);
		const { id, ...profile } = preset;
		await writeFile(
			join(home, `presets/${id}.yaml`),
			stringify({
				schema: 1,
				...profile,
				// Standalone task sessions have no opener to inherit from, so the user's own task power is explicit here.
				capabilities: ["read", "write", "exec", "network"],
				...(id === "research" ? { plugins: ["agent-presets", "web-tools"] } : {}),
			}),
			{ flag: "wx" },
		);
	}
	await scaffoldWorkspace(
		filesFor(home, config, plugins, "main"),
		profileFor(home, config, agent).resolved.contexts,
		plugins.contexts,
	);
	return { home, agent: "main", model: config.defaultModel };
}

export async function inspectHome(home: string) {
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
		const health = new ModelHealth(join(home, ".yonder", "model-health.json"));
		const quota = new ModelQuota(join(home, ".yonder", "model-quota.json"));
		try {
			await Promise.all([health.load(), quota.load()]);
		} catch (error) {
			return { ok: false, errors: [...errors, `model chain state unavailable: ${message(error)}`], warnings };
		}
		const gate = new ModelGate(health, quota);
		const healthRecords = health.snapshot();
		const modelChains: {
			profile: string;
			entries: {
				model: string;
				slot: string;
				startOrder: number;
				held: boolean;
				quotaBlocked: boolean;
				holdUntil?: number;
				probeAt?: number;
			}[];
		}[] = [];
		const addChain = (name: string, selected: ReturnType<typeof resolveProfile>) => {
			let chain: ReturnType<typeof modelChain>;
			try {
				chain = modelChain(selected.model, selected.fallback, selected.credentialSlots);
			} catch (error) {
				errors.push(`${name}: model chain unavailable: ${message(error)}`);
				return;
			}
			const ordered = gate.order(chain, selected.fallback?.quotaStopPercent);
			modelChains.push({
				profile: name,
				entries: chain.map((entry) => {
					const key = chainKey(entry);
					const held = health.held(key);
					const record = healthRecords[key];
					return {
						model: `${entry.base}/${entry.modelId}`,
						slot: entry.slot,
						startOrder: ordered.indexOf(entry) + 1,
						held,
						quotaBlocked: quota.blocked(
							accountKey(entry.base, entry.slot),
							selected.fallback?.quotaStopPercent?.[entry.slot],
						),
						...(held && record ? { holdUntil: record.until, probeAt: record.probeAt } : {}),
					};
				}),
			});
		};
		for (const agent of agents.values()) {
			if (agent.archivedAt) continue;
			const env = config.agents?.find((item) => item.id === agent.id)?.env;
			for (const [name, profile] of Object.entries(agent.profiles))
				addChain(`${agent.id}/${name}`, resolveProfile(profile, agent.defaults, env, config.defaultModel));
		}
		for (const [id, preset] of new Map([...plugins.presets, ...presets]))
			addChain(`preset:${id}`, resolveProfile(preset, {}, "local", config.defaultModel));
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
		for (const agent of agents.values()) {
			if (agent.archivedAt) continue;
			const env = config.agents?.find((item) => item.id === agent.id)?.env;
			for (const [name, profile] of Object.entries(agent.profiles)) {
				const { model, fallback } = resolveProfile(profile, agent.defaults, env, config.defaultModel);
				const accounts = fallback?.accounts?.[model.slice(0, model.indexOf("/"))] ?? [];
				if (fallback?.models.length && !accounts.length && fallback.models.every((ref) => ref === model))
					warnings.push(
						`${agent.id}/${name}: fallback 只有主模型 ${model} 本身，等于没有备用；已按无备用处理，沿用自动重试。`,
					);
			}
			if (!canReceivePeerAsk(agent)) {
				const fix = peerFix(agent, env, config.defaultModel);
				warnings.push(
					`${agent.id}: 其他 agent 的 agent_ask 收不到它（没有 channel=agent、kind=agent 的绑定；若是有意隔离可忽略）。${fix ? `加入 agent.yaml：\n${fix}` : "它已有同名 peer 配置，请检查绑定。"}`,
				);
			}
		}
		return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], modelChains };
	} catch (error) {
		return { ok: false, errors: [message(error)], warnings };
	}
}
