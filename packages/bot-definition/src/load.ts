import { join } from "node:path";
import type { SourceDirectory } from "@yonder/bot-definition/source";
import type { Preset } from "@yonder/sdk";
import { ConfigError, parseAgentConfig, parsePresetConfig, parseYonderConfig, type WorkspaceFiles } from "./index.js";
import type { AgentConfig, YonderConfig } from "./schema.js";
import { loadSubagentDefinitionsFrom } from "./subagents.js";

export async function loadYonderConfigFrom(
	directory: SourceDirectory,
	onRead?: (file: string, text: string) => void,
	onFailure?: () => void,
): Promise<YonderConfig> {
	const file = join(directory.root, "yonder.yaml");
	const text = await directory.files.readFile("yonder.yaml");
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

export async function presetFilesFrom(directory: SourceDirectory): Promise<string[]> {
	try {
		return (await directory.files.list("presets"))
			.filter((entry) => entry.type === "file" && entry.name.endsWith(".yaml"))
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

export async function loadPresetsFrom(
	directory: SourceDirectory,
	onRead?: (file: string, text: string) => void,
): Promise<Map<string, Preset>> {
	const presets = new Map<string, Preset>();
	const issues: ConstructorParameters<typeof ConfigError>[0] = [];
	for (const name of await presetFilesFrom(directory)) {
		const file = join(directory.root, "presets", name);
		try {
			const id = name.slice(0, -5);
			const text = await directory.files.readFile(join("presets", name));
			onRead?.(file, text);
			presets.set(id, parsePresetConfig(text, id, file));
		} catch (error) {
			if (!(error instanceof ConfigError)) throw error;
			issues.push(...error.issues);
		}
	}
	if (issues.length) throw new ConfigError(issues);
	for (const [id, definition] of await loadSubagentDefinitionsFrom(directory)) presets.set(id, definition);
	return presets;
}
