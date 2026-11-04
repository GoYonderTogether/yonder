import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withConsoleBinding, withoutRuntimeBindings } from "@yonder/bot-core/kernel/console";
import type { AgentOperabilityFact } from "@yonder/bot-core/kernel/operability";
import { withDefaultPeer } from "@yonder/bot-core/kernel/peer";
import {
	type AgentConfig,
	ConfigError,
	parseAgentConfig,
	parsePresetConfig,
	parseYonderConfig,
	resolveProfile,
	type WorkspaceFiles,
	type YonderConfig,
} from "@yonder/local-host/config/index";
import type { Preset, Profile } from "@yonder/sdk";
import lockfile from "proper-lockfile";
import { parseDocument, stringify } from "yaml";

export interface ObjectRequest {
	action: string;
	id?: string;
	preset?: string;
	expectedFileRevision?: string;
	value?: unknown;
}
export interface ManagementState {
	config: YonderConfig;
	agents: Map<string, AgentConfig>;
	presets: Map<string, Preset>;
	files(config: YonderConfig, id: string): WorkspaceFiles;
	validate(config: YonderConfig, agents: Map<string, AgentConfig>, presets: Map<string, Preset>): Promise<void>;
	scaffold(config: YonderConfig, agent: AgentConfig): Promise<void>;
	reload?: () => Promise<void>;
	projectOperability?: (
		agentId: string,
		input: {
			config: YonderConfig;
			agents: Map<string, AgentConfig>;
			basis: "accepted" | "candidate";
			revision?: string;
		},
	) => Promise<AgentOperabilityFact>;
}
async function replace(file: string, text: string) {
	const temp = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, text, { flag: "wx", mode: 0o600 });
		await rename(temp, file);
	} finally {
		await rm(temp, { force: true });
	}
}
export async function manageObjects(home: string, request: ObjectRequest, state: ManagementState) {
	const [kind, action] = request.action.split(".");
	if (kind !== "agents" && kind !== "presets") throw new Error("Unknown management object");
	const showAgent = (id: string) => {
		const value = state.agents.get(id),
			entry = state.config.agents?.find((a) => a.id === id);
		if (!value || !entry) throw new Error(`Unknown agent: ${id}`);
		return { ...value, workspace: resolve(home, entry.workspace), env: entry.env ?? "local" };
	};
	const operability = async (
		agentId: string,
		config: YonderConfig,
		agents: Map<string, AgentConfig>,
		basis: "accepted" | "candidate",
		revision?: string,
	) => {
		if (!state.projectOperability) return undefined;
		try {
			return await state.projectOperability(agentId, { config, agents, basis, ...(revision ? { revision } : {}) });
		} catch {
			return { status: "unknown" as const, limit: 20, truncated: false, conversations: [] };
		}
	};
	if (action === "list")
		return kind === "agents" ? [...state.agents.keys()].map(showAgent) : [...state.presets.values()];
	const id = request.id;
	if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("id: use lowercase letters, digits and hyphens");
	if (action === "show") {
		if (kind === "agents") return showAgent(id);
		const value = state.presets.get(id);
		if (!value) throw new Error(`Unknown preset: ${id}`);
		return value;
	}
	if (!["create", "update", "validate", "archive", "remove", "restore"].includes(action ?? ""))
		throw new Error("Unknown management action");
	const unlock = await lockfile.lock(join(home, "yonder.yaml"));
	try {
		const configFile = join(home, "yonder.yaml");
		const yonderText = await readFile(configFile, "utf8");
		const document = parseDocument(yonderText);
		const disk = parseYonderConfig(document.toString(), join(home, "yonder.yaml"));
		const { agents: _diskAgents, ...otherDisk } = disk;
		const { agents: _runningAgents, ...otherRunning } = state.config;
		const restartRequired = JSON.stringify(otherDisk) !== JSON.stringify(otherRunning);
		const config = structuredClone(state.config),
			agents = new Map(state.agents),
			presets = new Map(state.presets);
		let text = "",
			file = "",
			agentSource: string | undefined,
			generated: AgentConfig | undefined;
		if (kind === "agents") {
			const prior = agents.get(id),
				entry = config.agents?.find((a) => a.id === id);
			if (action === "create") {
				if (entry) throw new Error(`Agent id already registered: ${id}`);
				const preset = presets.get(request.preset ?? "");
				if (!preset) throw new Error(`Unknown preset: ${request.preset}`);
				const value = request.value as Record<string, unknown> | undefined;
				if (!value || !value.name || !value.work || !value.owner || !Array.isArray(value.bindings))
					throw new Error("name, work, owner and explicit bindings are required");
				const { id: _id, description: _description, ...profile } = preset;
				const selected = resolveProfile(
					{ ...profile, ...((value.profile as Profile) ?? {}) },
					{},
					"local",
					state.config.defaultModel,
				);
				const { level, capabilities, ...rest } = selected;
				rest.plugins = [...new Set([...rest.plugins, "learning"])];
				generated = parseAgentConfig(
					stringify({
						schema: 1,
						id,
						name: value.name,
						...(value.avatarUrl !== undefined ? { avatarUrl: value.avatarUrl } : {}),
						work: value.work,
						owner: value.owner,
						defaultProfile: "default",
						profiles: { default: { ...rest, ...(level ? { level } : { capabilities }) } },
						bindings: value.bindings,
					}),
					"agent.yaml",
					id,
				);
				generated = withDefaultPeer(generated, value.isolated, "local", config.defaultModel);
				config.agents = [...(config.agents ?? []), { id, workspace: `./agents/${id}` }];
				const files = state.files(config, id);
				if (await files.exists(".")) throw new Error(`Workspace already exists: ${resolve(home, `agents/${id}`)}`);
				agents.set(id, withConsoleBinding(generated, config));
			} else {
				if (!prior || !entry) throw new Error(`Unknown agent: ${id}`);
				if (["archive", "remove"].includes(action!)) {
					if (id === "main") throw new Error("Default main agent must retain the daily entry; archive is unavailable");
					entry.archivedAt = prior.archivedAt ?? new Date().toISOString();
					agents.set(id, { ...prior, archivedAt: entry.archivedAt });
				} else if (action === "restore") {
					delete entry.archivedAt;
					const { archivedAt: _, ...active } = prior;
					agents.set(id, active);
				} else {
					const value = request.value as Record<string, unknown> | undefined;
					if (!value) throw new Error("value: agent configuration patch required");
					const files = state.files(config, id);
					const diskAgentText = await files.readFile("agent.yaml");
					agentSource = diskAgentText;
					if (
						request.expectedFileRevision &&
						createHash("sha256").update(diskAgentText).digest("hex") !== request.expectedFileRevision
					)
						throw new Error("Config changed while updating; retry with config.get");
					const { workspace, env, ...patch } = value;
					if (workspace !== undefined) entry.workspace = String(workspace);
					if (env !== undefined) entry.env = String(env);
					if (
						(workspace !== undefined || env !== undefined) &&
						(entry.workspace !== state.config.agents?.find((a) => a.id === id)?.workspace ||
							entry.env !== state.config.agents?.find((a) => a.id === id)?.env)
					) {
						if (await state.files(config, id).exists("."))
							throw new Error(
								"New workspace already exists; workspace/env request a location or environment change. If the request only changes the model or group policy, omit workspace/env from agents.update and keep only the requested fields, then run agents.validate/update and verify with agents.show. Only when the original request explicitly asks for a migration, choose an unused workspace path, handle open sessions, then validate/update and read back with agents.show; never overwrite or move the existing workspace implicitly.",
							);
					}
					const source = parseDocument(diskAgentText, { prettyErrors: false });
					if (source.errors.length)
						throw new ConfigError(source.errors.map(({ message }) => ({ file: "agent.yaml", path: "/", message })));
					const mapping: unknown = source.toJS();
					if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
						throw new ConfigError([{ file: "agent.yaml", path: "/", message: "必须为 YAML mapping" }]);
					const stored = mapping as Record<string, unknown>;
					if (stored.id !== id)
						throw new ConfigError([
							{ file: "agent.yaml", path: "/id", message: "必须等于 yonder.yaml 登记的 agent id" },
						]);
					const candidate = parseAgentConfig(stringify({ ...stored, ...patch }), "agent.yaml", id);
					const { archivedAt: _, ...effective } = withoutRuntimeBindings(candidate);
					agents.set(
						id,
						withConsoleBinding({ ...effective, ...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}) }, config),
					);
					text = stringify(effective);
					file = "agent.yaml";
				}
			}
		} else {
			if (["archive", "restore"].includes(action!)) throw new Error("Presets do not support archive/restore");
			if (action === "remove") {
				if (!presets.has(id)) throw new Error(`Unknown preset: ${id}`);
				presets.delete(id);
			} else {
				const prior = presets.get(id);
				if (action === "create" && prior) throw new Error(`Preset already exists: ${id}`);
				if (action === "update" && !prior) throw new Error(`Unknown preset: ${id}`);
				const { id: _, ...stored } = prior ?? {};
				text = stringify({ schema: 1, ...stored, ...(request.value as object) });
				presets.set(id, parsePresetConfig(text, id));
			}
			file = join(home, "presets", `${id}.yaml`);
		}
		parseYonderConfig(stringify(config), join(home, "yonder.yaml"));
		await state.validate(config, agents, presets);
		if (action === "validate")
			return {
				valid: true,
				accepted: false,
				saved: false,
				...(kind === "agents" && state.projectOperability
					? {
							operability: await operability(
								id,
								config,
								agents,
								"candidate",
								createHash("sha256").update(text).digest("hex"),
							),
						}
					: {}),
			};
		if ((await readFile(configFile, "utf8")) !== yonderText)
			throw new Error("yonder.yaml changed while updating; retry with agents.show");
		const rollback: Array<() => Promise<void>> = [];
		const retained: string[] = [];
		const rememberLocal = async (path: string, after: string | undefined) => {
			const before = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return undefined;
				throw error;
			});
			if (after === undefined) await rm(path);
			else await replace(path, after);
			rollback.push(async () => {
				const current = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") return undefined;
					throw error;
				});
				if (current !== after) throw new Error(`${path} changed after this write; preserving concurrent content`);
				if (before === undefined) await rm(path, { force: true });
				else await replace(path, before);
			});
		};
		try {
			if (kind === "agents") {
				const files = state.files(config, id);
				if (generated) {
					const agentText = stringify(generated);
					await files.writeFile("agent.yaml", agentText);
					rollback.push(async () => {
						if ((await files.readFile("agent.yaml")) !== agentText)
							throw new Error(`agents/${id}/agent.yaml changed after this write; preserving concurrent content`);
						retained.push(`new agents/${id} workspace retained after failed reload`);
					});
					await state.scaffold(config, generated);
				} else if (text) {
					const before = await files.readFile(file);
					if (kind === "agents" && before !== agentSource)
						throw new Error("Config changed while updating; retry with config.get");
					await files.writeFile(file, text);
					rollback.push(async () => {
						if ((await files.readFile(file)) !== text)
							throw new Error(`${file} changed after this write; preserving concurrent content`);
						await files.writeFile(file, before);
					});
				}
				document.set("agents", config.agents);
				await rememberLocal(configFile, document.toString());
			} else {
				await mkdir(join(home, "presets"), { recursive: true });
				await rememberLocal(file, action === "remove" ? undefined : text);
			}
			await state.reload?.();
		} catch (error) {
			const failures: string[] = [];
			for (const restore of rollback.reverse())
				try {
					await restore();
				} catch (rollbackError) {
					failures.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
				}
			if (!failures.length && state.reload)
				try {
					await state.reload();
				} catch (rollbackError) {
					failures.push(
						`restore reload failed: ${rollbackError instanceof Error ? rollbackError.message : rollbackError}`,
					);
				}
			if (failures.length)
				throw new Error(
					`management reload/write failed: ${error instanceof Error ? error.message : error}; rollback failed: ${failures.join("; ")}`,
				);
			if (retained.length)
				throw new Error(
					`management reload/write failed: ${error instanceof Error ? error.message : error}; ${retained.join("; ")}`,
				);
			throw error;
		}
		const revisionText =
			kind === "agents"
				? await state.files(config, id).readFile("agent.yaml")
				: action === "remove"
					? `removed:${id}`
					: await readFile(file, "utf8");
		const acceptedOperability =
			kind === "agents" && action === "update" && state.projectOperability
				? await operability(
						id,
						state.config,
						state.agents,
						"accepted",
						createHash("sha256").update(revisionText).digest("hex"),
					)
				: undefined;
		return {
			id,
			valid: true,
			saved: true,
			accepted: !!state.reload,
			restartRequired,
			revision: createHash("sha256").update(revisionText).digest("hex"),
			...(acceptedOperability ? { operability: acceptedOperability } : {}),
			...(kind === "agents"
				? {
						workspace: resolve(home, config.agents!.find((a) => a.id === id)!.workspace),
						name: agents.get(id)!.name,
						work: agents.get(id)!.work,
						archivedAt: agents.get(id)!.archivedAt,
						messageEntry: agents.get(id)!.bindings.length > 0 && !agents.get(id)!.archivedAt,
					}
				: {}),
		};
	} finally {
		await unlock();
	}
}
