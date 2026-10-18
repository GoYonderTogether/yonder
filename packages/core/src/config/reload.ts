import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EventInput, Preset } from "@yonder/sdk";
import { ConfigError, parseAgentConfig, parsePresetConfig, presetFiles, type WorkspaceFiles } from "./index.js";
import type { AgentConfig } from "./schema.js";

interface WatchConfigOptions {
	home: string;
	agents: Map<string, AgentConfig>;
	presets: Map<string, Preset>;
	workspaceFiles: (id: string) => WorkspaceFiles | Promise<WorkspaceFiles>;
	onReload: (event: EventInput) => void | Promise<void>;
}

const configError = (error: unknown): string[] => error instanceof ConfigError
	? error.issues.map(issue => `${issue.file}:${issue.path}: ${issue.message}`)
	: [error instanceof Error ? error.message : String(error)];

export async function watchConfig({ home, agents, presets, workspaceFiles, onReload }: WatchConfigOptions): Promise<{ reload(): Promise<void>; close(): void }> {
	const seenAgents = new Map<string, string>();
	const seenPresets = new Map<string, string>();
	const homePresetIds = new Set(presets.keys());
	let closed = false;
	let running = false;

	for (const id of agents.keys()) {
		try { seenAgents.set(id, await (await workspaceFiles(id)).readFile("agent.yaml")); } catch { /* Initial load state is owned by the caller. */ }
	}
	try {
		for (const name of await presetFiles(home)) seenPresets.set(name, await readFile(join(home, "presets", name), "utf8"));
	} catch { /* Initial load state is owned by the caller. */ }

	const emit = (file: string, ok: boolean, errors?: string[]) => onReload({
		type: "config.reload",
		data: { file, ok, ...(errors?.length ? { errors } : {}) },
	});

	const reload = async () => {
		if (closed || running) return;
		running = true;
		try {
			for (const id of agents.keys()) {
				const file = `agents/${id}/agent.yaml`;
				let text: string;
				try { text = await (await workspaceFiles(id)).readFile("agent.yaml"); }
				catch (error) {
					const marker = `!error:${String(error)}`;
					if (seenAgents.get(id) !== marker) {
						seenAgents.set(id, marker);
						if (!closed) await emit(file, false, configError(error));
					}
					continue;
				}
				if (seenAgents.get(id) === text) continue;
				seenAgents.set(id, text);
				try {
					const config = parseAgentConfig(text, file, id);
					agents.set(id, config);
					if (!closed) await emit(file, true);
				} catch (error) {
					if (!closed) await emit(file, false, configError(error));
				}
			}

			const names = await presetFiles(home);
			const present = new Set(names);
			for (const id of homePresetIds) {
				if (![...present].some(name => name.slice(0, -5) === id)) presets.delete(id);
			}
			homePresetIds.clear();
			for (const name of names) {
				const file = join(home, "presets", name);
				const id = name.slice(0, -5);
				let text: string;
				try { text = await readFile(file, "utf8"); }
				catch (error) {
					const marker = `!error:${String(error)}`;
					if (seenPresets.get(name) !== marker) {
						seenPresets.set(name, marker);
						if (!closed) await emit(file, false, configError(error));
					}
					continue;
				}
				if (seenPresets.get(name) === text) {
					homePresetIds.add(id);
					continue;
				}
				seenPresets.set(name, text);
				try {
					presets.set(id, parsePresetConfig(text, id, file));
					homePresetIds.add(id);
					if (!closed) await emit(file, true);
				} catch (error) {
					homePresetIds.add(id);
					if (!closed) await emit(file, false, configError(error));
				}
			}
			for (const name of seenPresets.keys()) if (!present.has(name)) seenPresets.delete(name);
		} catch (error) {
			if (!closed) await emit(join(home, "presets"), false, configError(error));
		} finally {
			running = false;
		}
	};

	const timer = setInterval(() => { void reload(); }, 1000);
	timer.unref();
	return { reload, close: () => { closed = true; clearInterval(timer); } };
}

