import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EventQuery, SessionInfo, SessionsAPI } from "@yonder/sdk";
import lockfile from "proper-lockfile";
import { parseDocument } from "yaml";
import { loadPresets, loadYonderConfig, parseYonderConfig, resolveProfile } from "../config/index.js";
import { type LoadedPlugins, loadPlugins, pluginDirectory } from "../plugins/index.js";
import { scaffoldWorkspace } from "../prompt/index.js";
import { openDatabase } from "../runtime/db.js";
import { inspectToolCatalog } from "../runtime/index.js";
import { addLocalSkill, removeLocalSkill } from "../skills/index.js";
import { createStore } from "../store/index.js";
import { configurationErrors, protectSessions } from "./home.js";
import { manageObjects } from "./management.js";
import { filesFor, inspectionServices, loadAgents, profileFor, skillsFor } from "./workspace.js";

export interface ManagementRequest {
	action: string;
	id?: string;
	source?: string;
	agent?: string;
	profile?: string;
	preset?: string;
	value?: unknown;
}
export async function manageHome(home: string, request: ManagementRequest, running?: LoadedPlugins): Promise<unknown> {
	const config = await loadYonderConfig(home);
	if (request.action === "skills.add" || request.action === "skills.remove") {
		const entry = request.agent ? config.agents?.find((item) => item.id === request.agent) : undefined;
		if (request.agent && !entry) throw new Error(`Unknown agent: ${request.agent}`);
		if (entry?.env && entry.env !== "local") throw new Error("Local skill management requires a local workspace");
		const target = { home, ...(entry ? { workspace: resolve(home, entry.workspace) } : {}) };
		return request.action === "skills.add"
			? addLocalSkill(request.source ?? "", target)
			: removeLocalSkill(request.id ?? "", target);
	}
	const services = inspectionServices(home, config, () => {});
	if (request.action === "models.list")
		return {
			source: "configured/native catalog; access not verified",
			models: services.models.getModels().map((model) => ({
				provider: model.provider,
				id: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
				input: model.input,
			})),
		};
	const loaded = await loadPlugins(home, config, services);
	const agents = await loadAgents(home, config, loaded);
	if (request.action.startsWith("agents.") || request.action.startsWith("presets.")) {
		const presets = new Map([...loaded.presets, ...(await loadPresets(home))]);
		return manageObjects(home, request, {
			config,
			agents,
			presets,
			files: (candidate, id) => filesFor(home, candidate, loaded, id),
			validate: async (candidate, nextAgents, nextPresets) => {
				const errors = configurationErrors(candidate, nextAgents, loaded, services.models, nextPresets);
				let identityDb: Awaited<ReturnType<typeof openDatabase>> | undefined;
				try {
					await stat(join(home, ".yonder/state.db"));
					identityDb = await openDatabase(join(home, ".yonder/state.db"), true);
					const identityStore = await createStore(identityDb, undefined, true);
					for (const agent of nextAgents.values())
						if (!agent.archivedAt && !(await identityStore.identity().person(agent.owner)))
							errors.push(`${agent.id}/owner: unknown person ${agent.owner}`);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					for (const agent of nextAgents.values())
						if (!agent.archivedAt && !candidate.identity?.persons.some((p) => `person:${p.id}` === agent.owner))
							errors.push(`${agent.id}/owner: unknown person ${agent.owner}`);
				} finally {
					await identityDb?.close();
				}
				let sessions: SessionInfo[] = [];
				try {
					await stat(join(home, ".yonder/state.db"));
					sessions = (await offlineQuery(home, {
						method: "sessions.list",
						params: { filter: { open: true } },
					})) as SessionInfo[];
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				protectSessions(config, candidate, agents, nextAgents, presets, nextPresets, sessions, errors);
				if (errors.length) throw new Error(errors.join("; "));
			},
			scaffold: async (candidate, agent) => {
				await scaffoldWorkspace(
					filesFor(home, candidate, loaded, agent.id),
					[...new Set(Object.values(agent.profiles).flatMap((p) => resolveProfile(p, agent.defaults).contexts))],
					loaded.contexts,
				);
			},
		});
	}
	const selectedAgent = () => {
		const value = agents.get(request.agent ?? "main");
		if (!value) throw new Error(`Unknown agent: ${request.agent}`);
		return value;
	};
	if (request.action === "inspect") {
		const session = profileFor(home, config, selectedAgent(), request.profile);
		const { instructions: _instructions, ...profile } = session.resolved;
		return {
			source: "disk configuration; runtime acceptance not implied",
			agent: session.agent,
			profile: session.profile,
			configurationFile: join(session.cwd, "agent.yaml"),
			cwd: session.cwd,
			...profile,
			plugins: profile.plugins,
			tools: inspectToolCatalog(session, loaded.tools),
			registeredPluginTools: [...loaded.tools].flatMap(([plugin, tools]) =>
				tools.map((tool) => ({ plugin, name: tool.name, capabilities: tool.capabilities })),
			),
			...(running ? { runtimeLoaded: (running.info ?? []).map((item) => item.id) } : { runtimeLoaded: null }),
		};
	}
	if (request.action === "skills.show")
		return skillsFor(home, config, loaded, () => {}).show(
			profileFor(home, config, selectedAgent(), request.profile),
			request.id ?? "",
		);
	if (request.action === "plugins.list" || request.action === "plugins.show") {
		const presets = new Map([...loaded.presets, ...(await loadPresets(home))]);
		const result = (loaded.info ?? []).map((info) => ({
			...info,
			source: "configured; setup validated",
			runtimeLoaded: running ? (running.info ?? []).some((item) => item.id === info.id) : null,
			selectedBy: [
				...[...presets]
					.filter(
						([, preset]) =>
							resolveProfile(preset).plugins.includes(info.id) ||
							resolveProfile(preset).contexts.some((id) =>
								((info.contributes as { contexts?: string[] }).contexts ?? []).includes(id),
							),
					)
					.map(([id]) => `preset:${id}`),
				...[...agents.values()].flatMap((agent) =>
					Object.keys(agent.profiles)
						.filter((profile) => {
							const selected = resolveProfile(agent.profiles[profile]!, agent.defaults);
							return (
								selected.plugins.includes(info.id) ||
								selected.contexts.some((id) =>
									((info.contributes as { contexts?: string[] }).contexts ?? []).includes(id),
								)
							);
						})
						.map((profile) => `${agent.id}/${profile}`),
				),
			],
			instances: [
				...[...loaded.channels.keys()]
					.filter(
						(id) =>
							config.channels?.[id] &&
							((info.contributes as { channels?: string[] }).channels ?? []).includes(config.channels[id].type),
					)
					.map((id) => `channel:${id}`),
				...[...loaded.envs.keys()]
					.filter((id) => ((info.contributes as { envs?: string[] }).envs ?? []).includes(config.envs![id]!.type))
					.map((id) => `env:${id}`),
			],
		}));
		if (request.action === "plugins.list") return result;
		const found = result.find((item) => item.id === request.id);
		if (!found) throw new Error(`Plugin not configured: ${request.id}`);
		return found;
	}
	if (request.action !== "plugins.add" && request.action !== "plugins.remove")
		throw new Error(`Unknown management action: ${request.action}`);
	const file = join(home, "yonder.yaml"),
		unlock = await lockfile.lock(file);
	try {
		const original = await readFile(file, "utf8"),
			document = parseDocument(original),
			candidate = parseYonderConfig(original, file);
		if (request.action === "plugins.add") {
			if (!request.source) throw new Error("Plugin source required");
			await pluginDirectory(home, request.source);
			candidate.plugins = [...(candidate.plugins ?? []), { use: request.source }];
		} else {
			const found = loaded.info?.find((item) => item.id === request.id);
			if (!found) throw new Error(`Plugin not configured: ${request.id}`);
			candidate.plugins = (candidate.plugins ?? []).filter((item) => item.use !== found.use);
		}
		const next = await loadPlugins(
			home,
			candidate,
			inspectionServices(home, candidate, () => {}),
		);
		const nextAgents = await loadAgents(home, candidate, next),
			presets = await loadPresets(home);
		const errors = configurationErrors(
			candidate,
			nextAgents,
			next,
			services.models,
			new Map([...next.presets, ...presets]),
		);
		if (request.action === "plugins.remove") {
			let hasDatabase = false;
			try {
				hasDatabase = (await stat(join(home, ".yonder/state.db"))).isFile();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (hasDatabase)
				for (const session of (await offlineQuery(home, {
					method: "sessions.list",
					params: { filter: { open: true } },
				})) as SessionInfo[]) {
					const exists = session.agent
						? nextAgents.get(session.agent)?.profiles[session.profile]
						: presets.has(session.profile) || next.presets.has(session.profile);
					if (!exists) errors.push(`session ${session.id}: close before removing profile/preset ${session.profile}`);
				}
		}
		if (errors.length) throw new Error(errors.join("; "));
		document.set("plugins", candidate.plugins);
		const temporary = `${file}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, document.toString(), { flag: "wx", mode: 0o600 });
			await rename(temporary, file);
		} finally {
			await rm(temporary, { force: true });
		}
		return { configured: true, restartRequired: true, action: request.action, source: request.source ?? request.id };
	} finally {
		await unlock();
	}
}

export async function offlineQuery(home: string, request: { method: string; params?: unknown }): Promise<unknown> {
	if (request.method === "management") return manageHome(home, request.params as ManagementRequest);
	const db = await openDatabase(join(home, ".yonder/state.db"), true);
	try {
		const store = await createStore(db, undefined, true);
		const params = (request.params ?? {}) as {
			filter?: Parameters<SessionsAPI["list"]>[0];
			query?: EventQuery;
			id?: string;
			ref?: string;
		};
		if (request.method === "sessions.list") return store.sessions.list(params.filter ?? {});
		if (request.method === "sessions.show") {
			const session = await store.sessions.get(params.id ?? "");
			if (!session) throw new Error(`Unknown session: ${params.id}`);
			const { readTranscript } = await import("../runtime/index.js");
			return { session, transcript: await readTranscript(db, session.id) };
		}
		if (request.method === "events.query") return store.events.query(params.query ?? {});
		if (request.method === "identity.lookup") return store.identity().lookup(params.ref ?? "");
		throw new Error("该操作需要先运行 yonder start");
	} finally {
		await db.close();
	}
}
