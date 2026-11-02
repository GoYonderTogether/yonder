import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Preset } from "@yonder/sdk";
import { ConfigError, parseAgentConfig, parsePresetConfig, parseYonderConfig, type WorkspaceFiles } from "./index.js";
import type { AgentConfig, YonderConfig } from "./schema.js";
import { loadSubagentDefinitions } from "./subagent-definitions.js";

export async function loadYonderConfig(
	home: string,
	onRead?: (file: string, text: string) => void,
	onFailure?: () => void,
): Promise<YonderConfig> {
	const file = join(home, "yonder.yaml");
	const text = await readFile(file, "utf8");
	onRead?.(file, text);
	try {
		return parseYonderConfig(text, file);
	} catch (error) {
		onFailure?.();
		throw error;
	}
}

export async function loadAgentConfig(
	files: WorkspaceFiles,
	expectedId: string,
	onRead?: (text: string) => void,
	onFailure?: () => void,
): Promise<AgentConfig> {
	const text = await files.readFile("agent.yaml");
	onRead?.(text);
	try {
		return parseAgentConfig(text, "agent.yaml", expectedId);
	} catch (error) {
		onFailure?.();
		throw error;
	}
}

export async function presetFiles(home: string): Promise<string[]> {
	try {
		return (await readdir(join(home, "presets"), { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export async function loadPresets(
	home: string,
	onRead?: (file: string, text: string) => void,
): Promise<Map<string, Preset>> {
	const presets = new Map<string, Preset>();
	const issues: ConstructorParameters<typeof ConfigError>[0] = [];
	for (const name of await presetFiles(home)) {
		const file = join(home, "presets", name);
		try {
			const id = name.slice(0, -5);
			const text = await readFile(file, "utf8");
			onRead?.(file, text);
			presets.set(id, parsePresetConfig(text, id, file));
		} catch (error) {
			if (!(error instanceof ConfigError)) throw error;
			issues.push(...error.issues);
		}
	}
	if (issues.length) throw new ConfigError(issues);
	for (const [id, definition] of await loadSubagentDefinitions(home)) presets.set(id, definition);
	return presets;
}
