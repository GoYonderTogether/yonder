import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Preset } from "@yonder/sdk";
import {
	type AgentConfig,
	loadYonderConfig,
	parseAgentConfig,
	parseYonderConfig,
	presetFiles,
	watchConfig,
	type YonderConfig,
} from "../config/index.js";
import type { LoadedPlugins } from "../plugins/index.js";
import type { Store } from "../store/index.js";
import { filesFor, type KernelLog, loadAgents } from "./workspace.js";

/** Hot reload of agent config: candidate loading, validation, scaffolding and publishing. */
export async function watchAgents({
	home,
	config,
	agents,
	presets,
	loaded,
	store,
	log,
	validateCandidate,
	scaffoldAgent,
	initialRevisions = new Map(),
}: {
	home: string;
	config: YonderConfig;
	agents: Map<string, AgentConfig>;
	presets: Map<string, Preset>;
	loaded: LoadedPlugins;
	store: Store;
	log: KernelLog;
	validateCandidate(
		candidateConfig: YonderConfig,
		candidateAgents: Map<string, AgentConfig>,
		candidatePresets: Map<string, Preset>,
	): Promise<void>;
	scaffoldAgent(agent: AgentConfig, candidate?: YonderConfig): Promise<void>;
	initialRevisions?: ReadonlyMap<string, string>;
}) {
	let pendingRestart = "";
	let observed = new Map<string, string>();
	let accepted = new Map(initialRevisions);
	let rejected = new Map<string, string>();
	let rejectedSources = new Set<string>();
	let candidateComplete = false;
	let acceptedCandidate = "";
	let rejectedCandidate = "";
	const hash = (text: string) => createHash("sha256").update(text).digest("hex");
	const fingerprint = (revisions: ReadonlyMap<string, string>) =>
		hash(JSON.stringify([...revisions].sort(([left], [right]) => left.localeCompare(right))));
	acceptedCandidate = initialRevisions.size ? fingerprint(initialRevisions) : "";
	const watcher = await watchConfig({
		home,
		agents,
		presets,
		workspaceFiles: (id) => filesFor(home, config, loaded, id),
		candidate: async () => {
			observed = new Map();
			rejectedSources = new Set();
			candidateComplete = false;
			const disk = await loadYonderConfig(
				home,
				(_file, text) => observed.set("home", hash(text)),
				() => rejectedSources.add("home"),
			);
			const { agents: _diskAgents, ...diskRest } = disk;
			const { agents: _runningAgents, ...activeRest } = config;
			const signature = JSON.stringify(diskRest);
			if (signature !== JSON.stringify(activeRest) && signature !== pendingRestart)
				log("warn", "Non-agent yonder.yaml changes require restart");
			pendingRestart = signature;
			const candidate = { ...config, agents: disk.agents ?? [] };
			const candidateAgents = await loadAgents(
				home,
				candidate,
				loaded,
				(id, text) => observed.set(`agent:${id}`, hash(text)),
				(id) => rejectedSources.add(`agent:${id}`),
			);
			candidateComplete = true;
			return {
				config: candidate,
				agents: candidateAgents,
			};
		},
		candidateRevisions: () => observed,
		onPresetRead: (file, text) => observed.set(`preset:${basename(file)}`, hash(text)),
		onCandidate: (ok, revisions) => {
			if (ok) {
				accepted = new Map(revisions);
				rejected = new Map();
				acceptedCandidate = fingerprint(revisions);
				rejectedCandidate = "";
			} else {
				rejected = new Map([...revisions].filter(([key]) => rejectedSources.has(key)));
				rejectedCandidate = candidateComplete ? fingerprint(revisions) : "";
			}
		},
		validate: async (nextAgents, nextPresets, nextConfig) => {
			await validateCandidate(nextConfig ?? config, nextAgents, nextPresets);
			for (const agent of nextAgents.values()) if (!agent.archivedAt) await scaffoldAgent(agent, nextConfig ?? config);
		},
		publish: (candidate) => {
			config.agents = candidate.agents ?? [];
		},
		onReload: async (event) => {
			await store.events.record(event);
		},
	});
	return {
		...watcher,
		async status(agentId?: string) {
			const state = async (key: string, revision: string, rootRestart = false) => {
				if (rootRestart) return "pending-restart" as const;
				if (accepted.get(key) === revision) return "effective" as const;
				if (rejected.get(key) === revision) return "rejected" as const;
				return "pending" as const;
			};
			try {
				const rootText = await readFile(join(home, "yonder.yaml"), "utf8");
				const rootRevision = hash(rootText);
				const disk = parseYonderConfig(rootText, "yonder.yaml");
				const currentSources = new Map<string, string>([["home", rootRevision]]);
				for (const entry of disk.agents ?? []) {
					const text = await filesFor(home, disk, loaded, entry.id).readFile("agent.yaml");
					currentSources.set(`agent:${entry.id}`, hash(text));
				}
				for (const name of await presetFiles(home)) {
					const text = await readFile(join(home, "presets", name), "utf8");
					currentSources.set(`preset:${name}`, hash(text));
				}
				const currentCandidate = fingerprint(currentSources);
				const { agents: _diskAgents, ...diskRest } = disk;
				const { agents: _runningAgents, ...activeRest } = config;
				const homeState = await state("home", rootRevision, JSON.stringify(diskRest) !== JSON.stringify(activeRest));
				let agentState: "effective" | "pending" | "rejected" | "pending-restart" | "unknown" | undefined;
				let agentRevision: string | undefined;
				if (agentId) {
					const files = filesFor(home, disk, loaded, agentId);
					const text = await files.readFile("agent.yaml");
					agentRevision = hash(text);
					try {
						parseAgentConfig(text, "agent.yaml", agentId);
						agentState = await state(`agent:${agentId}`, agentRevision);
					} catch {
						agentState = rejected.get(`agent:${agentId}`) === agentRevision ? "rejected" : "pending";
					}
				}
				return {
					home: { state: homeState, revision: rootRevision.slice(0, 12), file: "yonder.yaml" },
					candidate: {
						state:
							currentCandidate === acceptedCandidate
								? homeState === "pending-restart"
									? ("pending-restart" as const)
									: ("effective" as const)
								: currentCandidate === rejectedCandidate
									? ("rejected" as const)
									: ("pending" as const),
						revision: currentCandidate.slice(0, 12),
					},
					...(agentId && agentRevision && agentState
						? { agent: { state: agentState, revision: agentRevision.slice(0, 12), file: "agent.yaml" } }
						: {}),
				};
			} catch {
				let revision: string | undefined;
				try {
					revision = createHash("sha256")
						.update(await readFile(join(home, "yonder.yaml"), "utf8"))
						.digest("hex");
				} catch {
					// Missing or unreadable source remains unknown; never infer an accepted snapshot.
				}
				return {
					home: {
						state: revision && rejected.get("home") === revision ? ("rejected" as const) : ("unknown" as const),
						file: "yonder.yaml",
						...(revision && rejected.get("home") === revision ? { revision: revision.slice(0, 12) } : {}),
					},
					candidate: { state: "unknown" as const },
					...(agentId ? { agent: { state: "unknown" as const, file: "agent.yaml" } } : {}),
				};
			}
		},
	};
}
