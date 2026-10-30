import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Preset, Profile } from "@yonder/sdk";
import lockfile from "proper-lockfile";
import { parseDocument, stringify } from "yaml";
import {
	type AgentConfig,
	parseAgentConfig,
	parsePresetConfig,
	parseYonderConfig,
	resolveProfile,
	type WorkspaceFiles,
	type YonderConfig,
} from "../config/index.js";

import { withConsoleBinding, withoutRuntimeBindings } from "./console.js";
import { withDefaultPeer } from "./peer.js";

export interface ObjectRequest {
	action: string;
	id?: string;
	preset?: string;
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
		const document = parseDocument(await readFile(join(home, "yonder.yaml"), "utf8"));
		const disk = parseYonderConfig(document.toString(), join(home, "yonder.yaml"));
		const { agents: _diskAgents, ...otherDisk } = disk;
		const { agents: _runningAgents, ...otherRunning } = state.config;
		const restartRequired = JSON.stringify(otherDisk) !== JSON.stringify(otherRunning);
		const config = structuredClone(state.config),
			agents = new Map(state.agents),
			presets = new Map(state.presets);
		let text = "",
			file = "",
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
					const { workspace, env, ...patch } = value;
					if (workspace !== undefined) entry.workspace = String(workspace);
					if (env !== undefined) entry.env = String(env);
					if (
						(workspace !== undefined || env !== undefined) &&
						(entry.workspace !== state.config.agents?.find((a) => a.id === id)?.workspace ||
							entry.env !== state.config.agents?.find((a) => a.id === id)?.env)
					) {
						if (await state.files(config, id).exists("."))
							throw new Error("New workspace already exists; directory migration/overwrite is not supported");
					}
					const { archivedAt: _, ...stored } = withoutRuntimeBindings(prior);
					const candidate = parseAgentConfig(stringify({ ...stored, ...patch }), "agent.yaml", id);
					agents.set(
						id,
						withConsoleBinding({ ...candidate, ...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}) }, config),
					);
					text = stringify(candidate);
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
		if (action === "validate") return { valid: true, accepted: false, saved: false };
		if (kind === "agents") {
			if (generated) {
				const files = state.files(config, id);
				await files.writeFile("agent.yaml", stringify(generated));
				await state.scaffold(config, generated);
			} else if (text) await state.files(config, id).writeFile(file, text);
			document.set("agents", config.agents);
			await replace(join(home, "yonder.yaml"), document.toString());
		} else {
			await mkdir(join(home, "presets"), { recursive: true });
			if (action === "remove") await rm(file);
			else await replace(file, text);
		}
		await state.reload?.();
		return {
			id,
			valid: true,
			saved: true,
			accepted: !!state.reload,
			restartRequired,
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
