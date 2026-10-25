import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
	Capability,
	Input,
	InputReceipt,
	Preset,
	RunResult,
	SessionInfo,
	SessionModels,
	SessionsAPI,
	YEvent,
} from "@yonder/sdk";
import { Check } from "typebox/value";
import {
	type AgentConfig,
	presetProfile,
	presetSession,
	type ResolvedProfile,
	resolveProfile,
	type YonderConfig,
} from "../config/index.js";
import { SessionModelsSchema } from "../config/schema.js";
import type { Runtime, RuntimeRun, RuntimeSessionConfig, RuntimeSessionState } from "../runtime/index.js";
import type { Store } from "../store/index.js";

interface CreateSessionsOptions {
	store: Store;
	agents: Map<string, AgentConfig>;
	homePresets: Map<string, Preset>;
	pluginPresets: Map<string, Preset>;
	home: string;
	config: YonderConfig;
	version: string;
	runtime: () => Runtime;
	onRun?: (session: SessionInfo, run: RuntimeRun, inputs: YEvent[], waiter: boolean) => void | Promise<void>;
	onReport?: (error: unknown) => void;
}

export function createSessions({
	store,
	agents,
	homePresets,
	pluginPresets,
	home,
	config,
	version,
	runtime,
	onRun,
	onReport = () => {},
}: CreateSessionsOptions) {
	const closing = new Set<string>();
	const opening = new Map<string, Promise<{ session: SessionInfo; profileMismatch: boolean }>>();
	const preset = (id: string) => homePresets.get(id) ?? pluginPresets.get(id);
	const runtimeProfile = (
		profile: Preset,
		env: string,
		capabilities?: Capability[],
		inherit?: RuntimeSessionState["inherit"],
		channelInstances?: string[],
	): ResolvedProfile => presetProfile(profile, env, capabilities, inherit, channelInstances);
	const workspace = (agent: string) => {
		const entry = config.agents?.find((candidate) => candidate.id === agent);
		if (!entry) throw new Error(`Unknown agent workspace: ${agent}`);
		return { cwd: resolve(home, entry.workspace), env: entry.env ?? "local" };
	};

	async function resolveBaseSession(id: string): Promise<RuntimeSessionConfig> {
		const row = await store.sessions.get(id);
		if (!row) throw new Error(`Unknown session: ${id}`);
		if (row.mode === "task") {
			const selected = preset(row.profile);
			if (!selected) throw new Error(`Unknown preset: ${row.profile}`);
			const state = await runtime().sessionState(id);
			if (!state) throw new Error(`Missing runtime session state: ${id}`);
			return {
				agent: null,
				profile: row.profile,
				cwd: state.cwd,
				resolved: runtimeProfile(selected, state.env, state.capabilities, state.inherit, state.channelInstances),
			};
		}
		if (!row.agent) throw new Error(`Agent session has no agent: ${id}`);
		const agent = agents.get(row.agent);
		if (!agent) throw new Error(`Unknown agent: ${row.agent}`);
		const selected = agent.profiles[row.profile];
		if (!selected) throw new Error(`Unknown profile ${row.profile} for agent ${row.agent}`);
		const { cwd, env } = workspace(row.agent);
		return {
			agent: row.agent,
			profile: row.profile,
			cwd,
			resolved: resolveProfile(selected, agent.defaults, env),
			bindings: agent.bindings,
			owner: agent.owner,
		};
	}

	async function resolveSession(id: string): Promise<RuntimeSessionConfig> {
		const base = await resolveBaseSession(id);
		const override = (await runtime().sessionState(id))?.models;
		return override ? { ...base, resolved: { ...base.resolved, ...override } } : base;
	}
	async function command(id: string, command: string): Promise<string> {
		const session = await store.sessions.get(id);
		if (!session || session.closed) throw new Error(`Not an open session: ${id}`);
		const profile = await runtime().sessionConfig(id);
		const caps = profile.resolved.capabilities;
		if (!caps.includes("read")) throw new Error("当前来源没有读取会话权限");
		const [name, ...args] = command.trim().split(/\s+/);
		const mutates = name === "compact" || (name === "model" && args.length > 0 && args[0] !== "list");
		if (mutates && !caps.includes("admin")) throw new Error("修改模型或压缩需要 admin 权限");
		if (name === "compact") {
			if (!caps.includes("network")) throw new Error("压缩需要 network 权限");
			return `已提交上下文压缩 · Session: ${id} · Task: ${await runtime().compact(id, args.join(" ") || undefined)}\n/status 查看进度`;
		}
		if (name !== "model" && name !== "status") throw new Error("仅支持 model / status / compact");
		if (name === "status" && args.length) throw new Error("用法：/status");
		if (name === "model" && args[0] === "list") {
			if (args.length > 2) throw new Error("用法：/model list [provider]");
			const all = runtime().models.getProviders();
			if (!args[1])
				return `供应商：\n${all.map((p) => `${p.id} · ${p.getModels().length} models`).join("\n")}\n/model list <provider> 查看模型`;
			const selected = all.find((p) => p.id === args[1]);
			if (!selected) throw new Error(`Unknown provider: ${args[1]}`);
			return (
				selected
					.getModels()
					.map((m) => `${selected.id}/${m.id} · context ${m.contextWindow} · output ${m.maxTokens}`)
					.join("\n") || "无模型"
			);
		}
		let changed = "";
		if (name === "model" && args.length) {
			const saved = (await runtime().sessionState(id))?.models ?? {};
			const selected = (await resolveSession(id)).resolved;
			let next: SessionModels | null;
			if (args[0] === "reset" && args.length === 1) next = null;
			else if (args[0] === "effort" && args.length === 2)
				next = { ...saved, thinking: args[1] as NonNullable<SessionModels["thinking"]> };
			else if (args[0] === "after" && args.length === 2)
				next = { ...saved, fallback: { models: selected.fallback?.models ?? [], after: Number(args[1]) } };
			else if (args.every((arg) => /^[^/]+\/.+$/.test(arg)))
				next = {
					...saved,
					model: args[0]!,
					fallback: { models: args.slice(1), after: selected.fallback?.after ?? 3 },
				};
			else throw new Error("用法：/model <provider/model> [fallback ...] | effort <level> | after <次数> | reset");
			if (next && !Check(SessionModelsSchema, next))
				throw new Error("无效模型设置：effort 必须是 off/minimal/low/medium/high/xhigh/max，after 必须是正整数");
			for (const ref of [next?.model, ...(next?.fallback?.models ?? [])].filter((ref): ref is string => !!ref)) {
				const slash = ref.indexOf("/");
				if (!runtime().models.getModel(ref.slice(0, slash), ref.slice(slash + 1)))
					throw new Error(`Unknown model: ${ref}`);
			}
			await runtime().configureModels(id, next);
			changed = (await runtime().hasPendingWork(id)) ? "设置已保存，下次运行生效。\n" : "会话模型设置已保存。\n";
		}
		const state = await runtime().modelStatus(id);
		const channels = session.agent
			? Object.entries(config.channels ?? {})
					.filter(([channel]) =>
						agents
							.get(session.agent!)
							?.bindings.some(
								(b) =>
									(b.match.type === undefined || b.match.type === "message.in") &&
									(session.mode !== "main" || b.session === "main") &&
									(!b.match.channel || [b.match.channel].flat().includes(channel)),
							),
					)
					.map(([id, c]) => `${id} (${c.type})`)
			: [];
		const tasks = await Promise.all(
			state.tasks.map(async (task) => {
				const child = await store.sessions.get(task.session);
				const active = child
					? await runtime()
							.sessionConfig(task.session)
							.catch(() => undefined)
					: undefined;
				let delegated = "";
				if (task.targetAgent && session.agent && caps.includes("cross-agent")) {
					const input = await store.events.findInput({
						type: "message.in",
						conv: `conv:agent:${session.agent}`,
						data: { msgId: `internal:${task.session}:${task.id}` },
					});
					const route = input?.routes?.find((route) => route.agent === task.targetAgent);
					if (route?.session) {
						const target = await runtime().modelStatus(route.session);
						delegated = ` · target Session ${route.session} · ${target.model ? `${target.model.provider}/${target.model.id}` : "未知模型"} · effort ${target.thinking} · target Tasks ${target.tasks.map((task) => task.id).join(", ") || "无"}`;
					}
				}
				return `${task.background ? "后台 " : ""}Task ${task.id} · ${task.name ?? task.kind} · ${task.state} · Session ${task.session}${child ? ` · Agent ${child.agent ?? "preset:" + child.profile}` : ""}${task.model ? ` · ${task.model} · effort ${task.thinking}` : active ? ` · ${active.resolved.model} · effort ${active.resolved.thinking}` : ""}${task.owner ? ` · parent task ${task.owner}` : ""}${task.targetAgent ? ` · 委派 Agent ${task.targetAgent}` : ""}${delegated}`;
			}),
		);
		return (
			changed +
			[
				`Agent: ${session.agent ?? "preset:" + session.profile} · Session: ${id} · ${state.running ? "运行中" : "空闲"}`,
				`供应商 / 模型: ${state.model ? state.model.provider + "/" + state.model.id : "不可用"}`,
				`主模型: ${state.primary} · Effort: ${state.thinking}`,
				`上下文估计: ${state.contextTokens} / ${state.model?.contextWindow ?? "未知"} tokens${state.model?.contextWindow ? `（${((state.contextTokens / state.model.contextWindow) * 100).toFixed(1)}%）` : ""} · 输出上限: ${state.model?.maxTokens ?? "未知"}`,
				`Compact: ${state.compact.reason}${state.compact.tasks.length ? " · Task " + state.compact.tasks.join(", ") : ""}${state.compact.failure ? ` · 上次失败: ${state.compact.failure}` : ""}`,
				`回退: ${state.fallback?.models.join(" → ") || "未配置"} · 连续失败 ${state.failures} / ${state.fallback?.after ?? 3}`,
				`会话绑定渠道: ${channels.join(", ") || "无"}`,
				`进行中任务 / 子 Agent:\n${tasks.join("\n") || "无"}`,
				"/model list [provider] · /model effort <level> · /compact [说明] · /status",
			].join("\n")
		);
	}

	async function createAgentSession(agentId: string, profileName: string, key: string, mode: SessionInfo["mode"]) {
		if (agents.get(agentId)?.archivedAt) throw new Error(`Agent archived: ${agentId}`);
		const lock = `${agentId}\0${key}`;
		const existing = opening.get(lock);
		if (existing) return existing;
		const creating = (async () => {
			const found = await store.sessions.find(agentId, key);
			if (found) return { session: found, profileMismatch: found.profile !== profileName };
			const agent = agents.get(agentId);
			if (!agent) throw new Error(`Unknown agent: ${agentId}`);
			const selected = agent.profiles[profileName];
			if (!selected) throw new Error(`Unknown profile ${profileName} for agent ${agentId}`);
			const { cwd, env } = workspace(agentId);
			const id = await runtime().create({ agent: agentId, profile: profileName, cwd, env });
			const session: SessionInfo = {
				id,
				agent: agentId,
				profile: profileName,
				mode,
				key,
				version,
				opened: new Date().toISOString(),
			};
			await store.sessions.put(session);
			await store.events.record({
				type: "session.open",
				from: `agent:${agentId}`,
				data: { session: id, mode, key, profile: profileName },
			});
			return { session, profileMismatch: false };
		})();
		opening.set(lock, creating);
		try {
			return await creating;
		} finally {
			opening.delete(lock);
		}
	}

	async function closeSession(id: string, reason = "closed"): Promise<void> {
		const session = await store.sessions.get(id);
		if (!session) throw new Error(`Unknown session: ${id}`);
		if (session.closed) return;
		await store.sessions.close(id);
		await store.events.record({
			type: "session.close",
			...(session.agent ? { from: `agent:${session.agent}` } : {}),
			data: { session: id, reason },
		});
	}

	async function failInput(session: SessionInfo, event: YEvent, error: unknown): Promise<RunResult> {
		onReport(error);
		const reason = error instanceof Error ? error.message : String(error);
		if (!(await runtime().admitted(session.id, event.id)))
			await onRun?.(
				session,
				{
					runId: `error:${event.id}`,
					status: "error",
					text: "",
					reason,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
					inputs: [event.id],
				},
				[event],
				(event.data as { waiting?: boolean }).waiting === true,
			);
		return { agent: session.agent, session: session.id, status: "error", text: "", reason };
	}
	async function submitTaskEvent(session: SessionInfo, event: YEvent): Promise<RunResult> {
		try {
			const data = event.data as Input & { busy?: "followup" | "steer" | "interrupt" };
			if (closing.has(session.id) || (await store.sessions.get(session.id))?.closed)
				throw new Error(`Session closed before admission: ${session.id}`);
			const run = await runtime().submit(session.id, {
				text: data.text,
				event,
				wake: "run",
				busy: data.busy ?? "steer",
				requestId: `event:${event.id}`,
				attachments: data.attachments ?? [],
			});
			return {
				agent: session.agent,
				session: session.id,
				status: run.status,
				text: run.text,
				...(run.reason ? { reason: run.reason } : {}),
				...(run.attachments?.length ? { attachments: run.attachments } : {}),
			};
		} catch (error) {
			return failInput(session, event, error);
		}
	}
	async function runTask(
		id: string,
		input: Input,
		wait: boolean,
		busy?: "followup" | "steer" | "interrupt",
		accepted?: (event: string) => void,
		from?: string,
	): Promise<RunResult | InputReceipt> {
		const session = await store.sessions.get(id);
		if (
			!session ||
			(session.mode !== "task" && !(from?.startsWith("plugin:") && ["main", "persistent"].includes(session.mode))) ||
			session.closed ||
			closing.has(id)
		)
			throw new Error(`Not an open task session: ${id}`);
		const event = await store.events.record({
			type: "session.input",
			...(from ? { from } : {}),
			data: {
				session: id,
				text: input.text,
				waiting: wait,
				busy: busy ?? "steer",
				...(input.attachments ? { attachments: input.attachments } : {}),
			},
		});
		accepted?.(event.id);
		const run = submitTaskEvent(session, event);
		if (wait) return run;
		void run.catch(onReport);
		return { event: event.id, session: id };
	}
	async function recover(): Promise<Array<() => void>> {
		const pending: Array<() => void> = [];
		let after: string | undefined;
		do {
			const page = await store.events.query({ type: "session.input", limit: 1000, ...(after ? { after } : {}) });
			for (const event of page.events) {
				const data = event.data as { session?: string; waiting?: boolean; busy?: string; taskOwned?: boolean };
				if (
					!data.session ||
					data.taskOwned ||
					(await store.events.runForInput(data.session, event.id)) ||
					(await runtime().admitted(data.session, event.id))
				)
					continue;
				const session = await store.sessions.get(data.session);
				if (!session || session.closed || data.waiting === undefined || data.busy === undefined) {
					onReport(new Error(`预设输入 ${event.id} 缺少可恢复接纳信息，不猜测重交`));
					continue;
				}
				pending.push(() => {
					void submitTaskEvent(session, event).catch(onReport);
				});
			}
			after = page.next;
		} while (after);
		return pending;
	}

	async function withPolicy(row: SessionInfo): Promise<SessionInfo> {
		return row.mode === "task" ? { ...row, close: (await runtime().sessionState(row.id))?.close ?? "run-end" } : row;
	}

	async function notifyFrom(id: string, input: { event: string; text: string }, from: string) {
		if (!from.trim()) throw new Error("Notification requires a program source");
		if (!input.event || typeof input.text !== "string" || !input.text.trim())
			throw new Error("Notification requires an event and text");
		const session = await store.sessions.get(id);
		if (!session || session.closed || closing.has(id)) throw new Error(`Not an open session: ${id}`);
		if (!(await store.events.get(input.event))) throw new Error(`Unknown notification event: ${input.event}`);
		return runtime().notify(id, { ...input, from });
	}

	const api: SessionsAPI = {
		command,
		notify: (id, input) => notifyFrom(id, input, "system:yonder"),
		list: async (filter) => Promise.all((await store.sessions.list(filter)).map(withPolicy)),
		get: async (id) => {
			const row = await store.sessions.get(id);
			return row ? withPolicy(row) : undefined;
		},
		async open(request) {
			const selected = preset(request.preset);
			if (!selected) throw new Error(`Unknown preset: ${request.preset}`);
			const parent = request.parent ? await store.sessions.get(request.parent) : undefined;
			if (request.parent && !parent) throw new Error(`Unknown parent session: ${request.parent}`);
			if (parent?.agent && agents.get(parent.agent)?.archivedAt) throw new Error(`Agent archived: ${parent.agent}`);
			const parentState = parent ? await runtime().sessionState(parent.id) : undefined;
			const parentProfile = parent ? await runtime().sessionConfig(parent.id) : undefined;
			const baseEnv = parentProfile?.resolved.env ?? parentState?.env ?? "local";
			const env = selected.env ?? baseEnv;
			const cwd = parentState?.cwd ?? parentProfile?.cwd ?? home;
			const { capabilities, channelInstances, inherit } = presetSession(
				selected,
				env,
				parentProfile?.resolved,
				request.capabilities,
			);
			const key = randomUUID();
			const id = await runtime().create({
				agent: null,
				profile: request.preset,
				cwd,
				env,
				capabilities,
				...(channelInstances === undefined ? {} : { channelInstances }),
				...(inherit ? { inherit } : {}),
				close: request.close ?? "run-end",
			});
			const session: SessionInfo = {
				id,
				agent: null,
				profile: request.preset,
				mode: "task",
				key,
				version,
				opened: new Date().toISOString(),
				...(request.parent ? { parent: request.parent } : {}),
			};
			await store.sessions.put(session);
			await store.events.record({
				type: "session.open",
				data: { session: id, mode: "task", key, profile: request.preset },
			});
			return withPolicy(session);
		},
		submit: ((id, input, options) =>
			runTask(id, input, options?.wait === true, options?.busy)) as SessionsAPI["submit"],
		abort: async (id) => {
			await runtime().abort(id);
		},
		close: async (id) => {
			closing.add(id);
			try {
				await runtime().abort(id);
				await closeSession(id);
			} finally {
				closing.delete(id);
			}
		},
		transcript: (id, range) => runtime().transcript(id, range),
	};

	return {
		api,
		recover,
		notifyFrom,
		submitFrom(
			id: string,
			input: Input,
			options: { wait?: boolean; busy?: "followup" | "steer" | "interrupt" } | undefined,
			from: string,
		) {
			return runTask(id, input, options?.wait === true, options?.busy, undefined, from);
		},
		resolveSession,
		ensureAgent: createAgentSession,
		closeSession,
		getPreset: preset,
		version,
		submitAccepted(id: string, input: Input, busy?: "followup" | "steer" | "interrupt"): Promise<InputReceipt> {
			return new Promise((resolve, reject) => {
				void runTask(id, input, false, busy, (event) => resolve({ event, session: id })).catch(reject);
			});
		},
	};
}

export type Sessions = ReturnType<typeof createSessions>;
