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
import { CREDENTIAL_MARK } from "../runtime/credential-failure.js";
import { chainKey, modelChain } from "../runtime/model-chain.js";
import { ModelGate } from "../runtime/model-gate.js";
import { ModelHealth } from "../runtime/model-health.js";
import { accountKey, ModelQuota } from "../runtime/model-quota.js";
import { type ChainEntryReport, chainCredentialMissing, modelChainIssues, unusableChainError } from "./host-status.js";
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
				// 名片渠道随包写进 channels 时，main 默认拿到它的 card_push 工具（JV2-J03-01）：
				// 起名片的工具在插件里，不在 Agent 清单时模型只能自己改 agent.yaml。
				plugins: [
					"context-files",
					"agent-presets",
					"learning",
					...(bundle.channels.card ? ["channel-card"] : []),
					...(onboarding ? ["tasks", "onboarding"] : []),
				],
			},
			// 名片群只读档案（SOC01 G-01）：群会话不继承主人能力，被 @ 时只读回答。
			profiles: {
				owner: { level: "bypass", tools: { offer: ["*"] } },
				...(bundle.channels.card ? { readonly: { level: "readonly" as const } } : {}),
			},
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
				// 名片渠道默认脚手架（SOC01 G-01）：主人的 DM 直接进主对话，群消息各自持久会话、只被 @ 时唤醒。
				...(bundle.channels.card
					? [
							{
								id: "card-owner",
								match: { channel: "card", kind: "dm", from: "owner" },
								session: "main" as const,
								profile: "owner",
							},
							{
								id: "card-group",
								match: { channel: "card", kind: "group" },
								session: { mode: "persistent" as const, per: "conv" as const },
								profile: "readonly",
								wake: "mention" as const,
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
		const siliconflow = config.models?.providers?.siliconflow as
			| { compat?: { supportsDeveloperRole?: boolean } }
			| undefined;
		if (siliconflow && siliconflow.compat?.supportsDeveloperRole !== false)
			warnings.push(
				"SiliconFlow 不支持 developer role；在 yonder.yaml 的 models.providers.siliconflow.compat 设置 supportsDeveloperRole: false。未显式设置时已使用此默认值。",
			);
		const glm = config.models?.providers?.["rightapi-glm"] as { compat?: { systemAsUser?: boolean } } | undefined;
		if (glm && glm.compat?.systemAsUser !== true)
			warnings.push(
				"rightapi-glm 的网关会丢弃开头的 system 消息，系统提示词到不了模型；在 yonder.yaml 的 models.providers.rightapi-glm.compat 设置 systemAsUser: true。未显式设置时已使用此默认值。",
			);
		const services = inspectionServices(home, config, (level, text) => {
			if (level !== "info") warnings.push(text);
		});
		const plugins = await loadPlugins(home, config, services);
		// BE-12：已弃用插件必须给出可执行的迁移路径，而不只是「请改用 X」。
		for (const plugin of plugins.info ?? [])
			if (plugin.deprecated)
				warnings.push(
					`${plugin.id} 已弃用：运行 yonder migrate 预览迁移计划，yonder migrate --apply 执行——它会改写 yonder.yaml 里的插件名，并把 .yonder/plugins/${plugin.id} 的状态目录一起迁到新插件（原文件保留 .pre-migrate 备份）。服务在跑时先 yonder stop；改完运行 yonder doctor 复查。`,
				);
		const agents = await loadAgents(home, config, plugins);
		const presets = await loadPresets(home);
		const errors = configurationErrors(
			config,
			agents,
			plugins,
			services.models,
			new Map([...plugins.presets, ...presets]),
		);
		const chainIssues = modelChainIssues(config, services.models);
		errors.push(...chainIssues.errors);
		warnings.push(...chainIssues.warnings);
		const health = new ModelHealth(join(home, ".yonder", "model-health.json"));
		const quota = new ModelQuota(join(home, ".yonder", "model-quota.json"));
		try {
			await Promise.all([health.load(), quota.load()]);
		} catch (error) {
			return { ok: false, errors: [...errors, `model chain state unavailable: ${message(error)}`], warnings };
		}
		const gate = new ModelGate(health, quota);
		const healthRecords = health.snapshot();
		const modelChains: Array<{ profile: string; entries: ChainEntryReport[] }> = [];
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
		// BE-06：一条链上一个能跑的候选都没有时就报错——只列 held/quotaBlocked 曾让 doctor 在整条链耗尽时仍 ok=true。
		for (const chain of modelChains) {
			const missing = await chainCredentialMissing(home, config, services.models, chain.entries);
			chain.entries = chain.entries.map((entry, index) =>
				missing.has(index) ? { ...entry, credentialMissing: true } : entry,
			);
			const error = unusableChainError(chain.profile, chain.entries);
			if (error) errors.push(error);
		}
		// 凭据类不可恢复错误（OAuth invalid_grant、缺 key）会让候选进入冷却并回退；提示主人重新登录。
		for (const [key, record] of Object.entries(healthRecords))
			if (record.until > Date.now() && record.reason.includes(CREDENTIAL_MARK))
				warnings.push(
					`${key}: 凭据不可用，运行已回退到下一个候选；重新登录后自动恢复：${record.reason.match(/run `([^`]+)`/)?.[1] ?? "yonder login <provider> --replace"}`,
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
			// BE-13：这条链路断了主人要能看懂影响、知道改哪个文件、改完怎么复查。
			if (!canReceivePeerAsk(agent)) {
				const fix = peerFix(agent, env, config.defaultModel);
				const workspace = config.agents?.find((item) => item.id === agent.id)?.workspace ?? `./agents/${agent.id}`;
				const file = `${workspace.replace(/^\.\//, "").replace(/\/$/, "")}/agent.yaml`;
				warnings.push(
					`${agent.id}: 别的 agent 用 agent_ask 问它时永远送不到——它没有 channel=agent、kind=agent 的绑定，peer 协作链在这里断开（调用方只会拿到「这是配置缺口」，不是它拒绝）。有意隔离可以忽略。修复：在 ${file} 里补上下面这段，然后运行 yonder doctor 复查。${fix ? `\n${fix}` : "它已有同名 peer 配置，请检查绑定。"}`,
				);
			}
		}
		return { ok: errors.length === 0, errors, warnings: [...new Set(warnings)], modelChains };
	} catch (error) {
		return { ok: false, errors: [message(error)], warnings };
	}
}
