import { join } from "node:path";
import type { EventInput, Preset } from "@yonder/sdk";
import { ConfigError, loadPresets, type WorkspaceFiles } from "./index.js";
import type { AgentConfig, YonderConfig } from "./schema.js";

interface WatchConfigOptions {
	home: string;
	agents: Map<string, AgentConfig>;
	presets: Map<string, Preset>;
	workspaceFiles: (id: string) => WorkspaceFiles | Promise<WorkspaceFiles>;
	candidate?: () => Promise<{ config: YonderConfig; agents: Map<string, AgentConfig> }>;
	publish?: (config: YonderConfig) => void;
	validate(agents: Map<string, AgentConfig>, presets: Map<string, Preset>, config?: YonderConfig): Promise<void>;
	onReload: (event: EventInput) => void | Promise<void>;
}

export async function watchConfig(options: WatchConfigOptions): Promise<{ reload(): Promise<void>; close(): void }> {
	const { home, agents, presets } = options;
	let closed = false;
	let queue = Promise.resolve();
	let previous = "";
	let failure = "";
	const reload = () => {
		const run = queue.then(async () => {
			if (closed) return;
			try {
				const candidate = options.candidate
					? await options.candidate()
					: { config: undefined, agents: new Map(agents) };
				if (!options.candidate) {
					const { parseAgentConfig } = await import("./index.js");
					for (const id of agents.keys())
						candidate.agents.set(
							id,
							parseAgentConfig(
								await (await options.workspaceFiles(id)).readFile("agent.yaml"),
								`agents/${id}/agent.yaml`,
								id,
							),
						);
				}
				const nextPresets = await loadPresets(home);
				const signature = JSON.stringify([candidate.config?.agents, [...candidate.agents], [...nextPresets]]);
				if (signature === previous) return;
				await options.validate(candidate.agents, nextPresets, candidate.config);
				if (candidate.config) options.publish?.(candidate.config);
				agents.clear();
				for (const entry of candidate.agents) agents.set(...entry);
				presets.clear();
				for (const entry of nextPresets) presets.set(...entry);
				previous = signature;
				failure = "";
				await options.onReload({ type: "config.reload", data: { file: join(home, "yonder.yaml"), ok: true } });
			} catch (error) {
				const errors =
					error instanceof ConfigError
						? error.issues.map((i) => `${i.file}:${i.path}: ${i.message}`)
						: [error instanceof Error ? error.message : String(error)];
				if (JSON.stringify(errors) !== failure)
					await options.onReload({
						type: "config.reload",
						data: { file: join(home, "yonder.yaml"), ok: false, errors },
					});
				failure = JSON.stringify(errors);
				throw error;
			}
		});
		queue = run.catch(() => {});
		return run;
	};
	const timer = setInterval(() => {
		void reload().catch(() => {});
	}, 1000);
	timer.unref();
	return {
		reload,
		close() {
			closed = true;
			clearInterval(timer);
		},
	};
}
