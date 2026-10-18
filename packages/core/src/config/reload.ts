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
	validate(agents: Map<string, AgentConfig>, presets: Map<string, Preset>): Promise<void>;
	onReload: (event: EventInput) => void | Promise<void>;
}

const configError = (error: unknown): string[] =>
	error instanceof ConfigError
		? error.issues.map((issue) => `${issue.file}:${issue.path}: ${issue.message}`)
		: [error instanceof Error ? error.message : String(error)];

export async function watchConfig({
	home,
	agents,
	presets,
	workspaceFiles,
	validate,
	onReload,
}: WatchConfigOptions): Promise<{ reload(): Promise<void>; close(): void }> {
	const seenAgents = new Map<string, string>();
	const seenPresets = new Map<string, string>();
	const failures = new Map<string, string>();
	let closed = false;
	let running = false;

	for (const id of agents.keys()) {
		try {
			const text = await (await workspaceFiles(id)).readFile("agent.yaml");
			if (JSON.stringify(parseAgentConfig(text, "agent.yaml", id)) === JSON.stringify(agents.get(id)))
				seenAgents.set(id, text);
		} catch {
			/* A changed or unreadable file is handled by reload. */
		}
	}
	try {
		for (const name of await presetFiles(home)) {
			const text = await readFile(join(home, "presets", name), "utf8");
			if (JSON.stringify(parsePresetConfig(text, name.slice(0, -5))) === JSON.stringify(presets.get(name.slice(0, -5))))
				seenPresets.set(name, text);
		}
	} catch {
		/* Initial load state is owned by the caller. */
	}

	const emit = async (file: string, ok: boolean, errors?: string[]) => {
		const failure = JSON.stringify(errors);
		if (!ok && failures.get(file) === failure) return;
		if (ok) failures.delete(file);
		else failures.set(file, failure);
		if (!closed) await onReload({ type: "config.reload", data: { file, ok, ...(errors?.length ? { errors } : {}) } });
	};

	const reload = async () => {
		if (closed || running) return;
		running = true;
		try {
			for (const id of agents.keys()) {
				const file = `agents/${id}/agent.yaml`;
				let text: string;
				try {
					text = await (await workspaceFiles(id)).readFile("agent.yaml");
				} catch (error) {
					await emit(file, false, configError(error));
					continue;
				}
				if (seenAgents.get(id) === text) {
					if (failures.has(file)) await emit(file, true);
					continue;
				}
				try {
					const config = parseAgentConfig(text, file, id);
					await validate(new Map(agents).set(id, config), presets);
					agents.set(id, config);
					seenAgents.set(id, text);
					await emit(file, true);
				} catch (error) {
					await emit(file, false, configError(error));
				}
			}

			const names = await presetFiles(home);
			const present = new Set(names);
			for (const id of presets.keys()) {
				if (present.has(`${id}.yaml`)) continue;
				const file = join(home, "presets", `${id}.yaml`);
				try {
					const candidate = new Map(presets);
					candidate.delete(id);
					await validate(agents, candidate);
					presets.delete(id);
					seenPresets.delete(`${id}.yaml`);
					await emit(file, true);
				} catch (error) {
					await emit(file, false, configError(error));
				}
			}
			for (const name of names) {
				const file = join(home, "presets", name);
				const id = name.slice(0, -5);
				let text: string;
				try {
					text = await readFile(file, "utf8");
				} catch (error) {
					await emit(file, false, configError(error));
					continue;
				}
				if (seenPresets.get(name) === text) {
					if (failures.has(file)) await emit(file, true);
					continue;
				}
				try {
					const preset = parsePresetConfig(text, id, file);
					await validate(agents, new Map(presets).set(id, preset));
					presets.set(id, preset);
					seenPresets.set(name, text);
					await emit(file, true);
				} catch (error) {
					await emit(file, false, configError(error));
				}
			}
		} catch (error) {
			await emit(join(home, "presets"), false, configError(error));
		} finally {
			running = false;
		}
	};

	const timer = setInterval(() => {
		void reload();
	}, 1000);
	timer.unref();
	return {
		reload,
		close: () => {
			closed = true;
			clearInterval(timer);
		},
	};
}
