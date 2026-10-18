import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Capability, Input, Preset, RunResult, SessionInfo, SessionsAPI, YEvent } from "@yonder/sdk";
import { type AgentConfig, type ResolvedProfile, resolveProfile, type YonderConfig } from "../config/index.js";
import type { Runtime, RuntimeInput, RuntimeRun, RuntimeSessionConfig } from "../runtime/index.js";
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
	prepareInput?: (session: SessionInfo, event: YEvent) => RuntimeInput | Promise<RuntimeInput>;
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
	prepareInput,
	onRun,
	onReport = () => {},
}: CreateSessionsOptions) {
	const closing = new Set<string>();
	const opening = new Map<string, Promise<{ session: SessionInfo; profileMismatch: boolean }>>();
	const preset = (id: string) => homePresets.get(id) ?? pluginPresets.get(id);
	const runtimeProfile = (profile: Preset, env: string, capabilities?: Capability[]): ResolvedProfile => {
		const resolved = resolveProfile(profile, {}, env);
		if (!capabilities) return resolved;
		const { level: _level, ...effective } = resolved;
		return {
			...effective,
			capabilities: resolved.capabilities.filter((capability) => capabilities.includes(capability)),
		};
	};
	const workspace = (agent: string) => {
		const entry = config.agents?.find((candidate) => candidate.id === agent);
		if (!entry) throw new Error(`Unknown agent workspace: ${agent}`);
		return { cwd: resolve(home, entry.workspace), env: entry.env ?? "local" };
	};

	async function resolveSession(id: string): Promise<RuntimeSessionConfig> {
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
				resolved: runtimeProfile(selected, state.env, state.capabilities),
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

	async function createAgentSession(agentId: string, profileName: string, key: string, mode: SessionInfo["mode"]) {
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

	async function submitTaskEvent(session: SessionInfo, event: YEvent): Promise<RunResult> {
		try {
			const data = event.data as Input & { busy?: "followup" | "steer" };
			const prepared = await prepareInput?.(session, event);
			if (closing.has(session.id) || (await store.sessions.get(session.id))?.closed)
				throw new Error(`Session closed during input preparation: ${session.id}`);
			const run = await runtime().submit(session.id, {
				...(prepared ?? { text: data.text }),
				event: prepared?.event ?? event,
				wake: "run",
				busy: data.busy ?? "followup",
				requestId: `event:${event.id}`,
				attachments: prepared?.attachments ?? data.attachments ?? [],
			});
			return {
				agent: session.agent,
				session: session.id,
				status: run.status,
				text: run.text,
				...(run.reason ? { reason: run.reason } : {}),
			};
		} catch (error) {
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
	}
	async function runTask(
		id: string,
		input: Input,
		wait: boolean,
		busy?: "followup" | "steer",
		accepted?: (event: string) => void,
		from?: string,
	): Promise<RunResult | void> {
		const session = await store.sessions.get(id);
		if (!session || session.mode !== "task" || session.closed || closing.has(id))
			throw new Error(`Not an open task session: ${id}`);
		const event = await store.events.record({
			type: "session.input",
			...(from ? { from } : {}),
			data: {
				session: id,
				text: input.text,
				waiting: wait,
				busy: busy ?? "followup",
				...(input.attachments ? { attachments: input.attachments } : {}),
			},
		});
		accepted?.(event.id);
		const run = submitTaskEvent(session, event);
		if (wait) return run;
		void run.catch(onReport);
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

	const api: SessionsAPI = {
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
			const parentState = parent ? await runtime().sessionState(parent.id) : undefined;
			const parentProfile = parent ? await runtime().sessionConfig(parent.id) : undefined;
			const baseEnv = parentProfile?.resolved.env ?? parentState?.env ?? "local";
			const env = selected.env ?? baseEnv;
			const cwd = parentState?.cwd ?? parentProfile?.cwd ?? home;
			const presetCapabilities = resolveProfile(selected, {}, env).capabilities;
			const parentCapabilities = parentProfile?.resolved.capabilities ?? presetCapabilities;
			const capabilities = presetCapabilities.filter(
				(capability) =>
					parentCapabilities.includes(capability) &&
					(!request.capabilities || request.capabilities.includes(capability)),
			);
			const key = randomUUID();
			const id = await runtime().create({
				agent: null,
				profile: request.preset,
				cwd,
				env,
				capabilities,
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
		submit: (id, input, options) => runTask(id, input, options?.wait === true, options?.busy),
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
		submitFrom(
			id: string,
			input: Input,
			options: { wait?: boolean; busy?: "followup" | "steer" } | undefined,
			from: string,
		) {
			return runTask(id, input, options?.wait === true, options?.busy, undefined, from);
		},
		resolveSession,
		ensureAgent: createAgentSession,
		closeSession,
		getPreset: preset,
		version,
		submitAccepted(id: string, input: Input, busy?: "followup" | "steer"): Promise<{ event: string }> {
			return new Promise((resolve, reject) => {
				void runTask(id, input, false, busy, (event) => resolve({ event })).catch(reject);
			});
		},
	};
}

export type Sessions = ReturnType<typeof createSessions>;
