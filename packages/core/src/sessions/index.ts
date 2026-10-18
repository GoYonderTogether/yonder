import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Capability, Input, Preset, RunResult, SessionInfo, SessionsAPI, YEvent } from "@yonder/sdk";
import { resolveProfile, type AgentConfig, type ResolvedProfile, type YonderConfig } from "../config/index.js";
import type { Store } from "../store/index.js";
import type { Runtime, RuntimeInput, RuntimeSessionConfig, RuntimeRun } from "../runtime/index.js";

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

export function createSessions({ store, agents, homePresets, pluginPresets, home, config, version, runtime, prepareInput, onRun, onReport = () => {} }: CreateSessionsOptions) {
	const opening = new Map<string, Promise<{ session: SessionInfo; profileMismatch: boolean }>>();
	const preset = (id: string) => homePresets.get(id) ?? pluginPresets.get(id);
	const runtimeProfile = (profile: Preset, env: string, capabilities?: Capability[]): ResolvedProfile => {
		const resolved = resolveProfile(profile, {}, env);
		if (!capabilities) return resolved;
		const { level: _level, ...effective } = resolved;
		return { ...effective, capabilities: resolved.capabilities.filter(capability => capabilities.includes(capability)) };
	};
	const workspace = (agent: string) => {
		const entry = config.agents?.find(candidate => candidate.id === agent);
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
			return { agent: null, profile: row.profile, cwd: state.cwd, resolved: runtimeProfile(selected, state.env, state.capabilities) };
		}
		if (!row.agent) throw new Error(`Agent session has no agent: ${id}`);
		const agent = agents.get(row.agent);
		if (!agent) throw new Error(`Unknown agent: ${row.agent}`);
		const selected = agent.profiles[row.profile];
		if (!selected) throw new Error(`Unknown profile ${row.profile} for agent ${row.agent}`);
		const { cwd, env } = workspace(row.agent);
		return { agent: row.agent, profile: row.profile, cwd, resolved: resolveProfile(selected, agent.defaults, env), bindings: agent.bindings, owner: agent.owner };
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
			const session: SessionInfo = { id, agent: agentId, profile: profileName, mode, key, version, opened: new Date().toISOString() };
			await store.sessions.put(session);
			await store.events.record({ type: "session.open", from: `agent:${agentId}`, data: { session: id, mode, key, profile: profileName } });
			return { session, profileMismatch: false };
		})();
		opening.set(lock, creating);
		try { return await creating; } finally { opening.delete(lock); }
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

	async function runTask(id: string, input: Input, wait: boolean): Promise<RunResult | void> {
		const session = await store.sessions.get(id);
		if (!session || session.mode !== "task" || session.closed) throw new Error(`Not an open task session: ${id}`);
		const event = await store.events.record({
			type: "session.input",
			data: { session: id, text: input.text, ...(input.attachments ? { attachments: input.attachments } : {}) },
		});
		await store.sessions.setVersion(id, version);
		const prepared = await prepareInput?.(session, event);
		const source = prepared ?? { text: input.text };
		const attachments = source.attachments ?? input.attachments;
		const run = runtime().submit(id, {
			text: source.text,
			event: source.event ?? event,
			wake: "run",
			...(attachments ? { attachments } : {}),
			...(source.onOutput ? { onOutput: source.onOutput } : {}),
			...(source.requestId ? { requestId: source.requestId } : {}),
		});
		if (!wait) {
			void run.then(async result => {
				await onRun?.(session, result, [], false);
				await closeSession(id, "completed");
			}).catch(async error => {
				try { await closeSession(id, "error"); } catch (closeError) { onReport(closeError); }
				onReport(error);
			});
			return;
		}
		try {
			const result = await run;
			await onRun?.(session, result, [], true);
			await closeSession(id, "completed");
			return { agent: session.agent, session: id, status: result.status, text: result.text, ...(result.reason ? { reason: result.reason } : {}) };
		} catch (error) {
			try { await closeSession(id, "error"); } catch (closeError) { onReport(closeError); }
			onReport(error);
			return { agent: session.agent, session: id, status: "error", text: "", reason: error instanceof Error ? error.message : String(error) };
		}
	}

	const api: SessionsAPI = {
		list: filter => store.sessions.list(filter),
		get: id => store.sessions.get(id),
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
			const capabilities = presetCapabilities.filter(capability => parentCapabilities.includes(capability) && (!request.capabilities || request.capabilities.includes(capability)));
			const key = randomUUID();
			const id = await runtime().create({ agent: null, profile: request.preset, cwd, env, capabilities });
			const session: SessionInfo = {
				id, agent: null, profile: request.preset, mode: "task", key, version, opened: new Date().toISOString(),
				...(request.parent ? { parent: request.parent } : {}),
			};
			await store.sessions.put(session);
			await store.events.record({ type: "session.open", data: { session: id, mode: "task", key, profile: request.preset } });
			return session;
		},
		submit: (id, input, options) => runTask(id, input, options?.wait === true),
		abort: async id => { await runtime().abort(id); },
		close: id => closeSession(id),
		transcript: (id, range) => runtime().transcript(id, range),
	};

	return { api, resolveSession, ensureAgent: createAgentSession, closeSession, getPreset: preset, version };
}

export type Sessions = ReturnType<typeof createSessions>;
