import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import type { BotSource } from "@yonder/bot-definition/source";
import {
	type AgentConfig,
	ConfigError,
	loadYonderConfigFrom,
	parseAgentConfig,
	parseYonderConfig,
	presetFilesFrom,
	watchConfig,
	type YonderConfig,
} from "@yonder/local-host/config/index";
import type { ConfigStatus } from "@yonder/local-host/kernel/config-facts";
import { createFsBotSource } from "@yonder/local-host/kernel/source-fs";
import { filesFor, type KernelLog, loadAgents } from "@yonder/local-host/kernel/workspace";
import type { LoadedPlugins } from "@yonder/local-host/plugins/index";
import type { Store } from "@yonder/local-host/store/index";
import type { Preset } from "@yonder/sdk";

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
	source = createFsBotSource(home, { envs: () => loaded.envs }),
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
	source?: BotSource;
}) {
	let pendingRestart = "";
	let observed = new Map<string, string>();
	let accepted = new Map(initialRevisions);
	let rejected = new Map<string, string>();
	let rejectedSources = new Set<string>();
	let candidateComplete = false;
	let acceptedCandidate = "";
	let rejectedCandidate = "";
	let rejectedIssues: Array<{ source: string; revision: string; path?: string }> = [];
	const hash = (text: string) => createHash("sha256").update(text).digest("hex");
	const fingerprint = (revisions: ReadonlyMap<string, string>) =>
		hash(JSON.stringify([...revisions].sort(([left], [right]) => left.localeCompare(right))));
	acceptedCandidate = initialRevisions.size ? fingerprint(initialRevisions) : "";
	const watcher = await watchConfig({
		home,
		source,
		agents,
		presets,
		workspaceFiles: (id) => filesFor(home, config, loaded, id, undefined, source),
		candidate: async () => {
			observed = new Map();
			rejectedSources = new Set();
			candidateComplete = false;
			const disk = await loadYonderConfigFrom(
				source.home,
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
				source,
			);
			candidateComplete = true;
			return {
				config: candidate,
				agents: candidateAgents,
			};
		},
		candidateRevisions: () => observed,
		onPresetRead: (file, text) => observed.set(`preset:${basename(file)}`, hash(text)),
		onCandidate: (ok, revisions, error) => {
			if (ok) {
				accepted = new Map(revisions);
				rejected = new Map();
				acceptedCandidate = fingerprint(revisions);
				rejectedCandidate = "";
				rejectedIssues = [];
			} else {
				const issues = error instanceof ConfigError ? error.issues : [];
				rejected = new Map(issues.length ? [...revisions].filter(([key]) => rejectedSources.has(key)) : []);
				rejectedCandidate = candidateComplete && issues.length ? fingerprint(revisions) : "";
				rejectedIssues = [];
				if (issues.length) {
					const source = [...rejected.keys()][0];
					if (source) {
						const revision = revisions.get(source);
						if (!revision) return;
						for (const issue of issues.slice(0, 3)) {
							const path =
								issue.path.length <= 128 && /^\/[A-Za-z0-9_~./:@-]*$/.test(issue.path) ? issue.path : undefined;
							rejectedIssues.push({ source, revision, ...(path ? { path } : {}) });
						}
					} else if (rejectedCandidate) {
						rejectedIssues.push({ source: "candidate", revision: rejectedCandidate });
					}
				}
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
		async status(agentId?: string): Promise<ConfigStatus> {
			const state = async (key: string, revision: string, rootRestart = false) => {
				if (rootRestart) return "pending-restart" as const;
				if (accepted.get(key) === revision) return "effective" as const;
				if (rejected.get(key) === revision) return "rejected" as const;
				return "pending" as const;
			};
			try {
				const rootText = await source.home.files.readFile("yonder.yaml");
				const rootRevision = hash(rootText);
				const disk = parseYonderConfig(rootText, "yonder.yaml");
				const currentSources = new Map<string, string>([["home", rootRevision]]);
				for (const entry of disk.agents ?? []) {
					const text = await filesFor(home, disk, loaded, entry.id, undefined, source).readFile("agent.yaml");
					currentSources.set(`agent:${entry.id}`, hash(text));
				}
				for (const name of await presetFilesFrom(source.home)) {
					const text = await source.home.files.readFile(join("presets", name));
					currentSources.set(`preset:${name}`, hash(text));
				}
				const currentCandidate = fingerprint(currentSources);
				const rejectedSourceMatches = [...rejected].some(([key, revision]) => currentSources.get(key) === revision);
				const { agents: _diskAgents, ...diskRest } = disk;
				const { agents: _runningAgents, ...activeRest } = config;
				const homeState = await state("home", rootRevision, JSON.stringify(diskRest) !== JSON.stringify(activeRest));
				let agentState: "effective" | "pending" | "rejected" | "pending-restart" | "unknown" | undefined;
				let agentRevision: string | undefined;
				if (agentId) {
					const files = filesFor(home, disk, loaded, agentId, undefined, source);
					const text = await files.readFile("agent.yaml");
					agentRevision = hash(text);
					try {
						parseAgentConfig(text, "agent.yaml", agentId);
						agentState = await state(`agent:${agentId}`, agentRevision);
					} catch {
						agentState = rejected.get(`agent:${agentId}`) === agentRevision ? "rejected" : "pending";
					}
				}
				const candidateState =
					currentCandidate === acceptedCandidate
						? homeState === "pending-restart"
							? ("pending-restart" as const)
							: ("effective" as const)
						: currentCandidate === rejectedCandidate || rejectedSourceMatches
							? ("rejected" as const)
							: ("pending" as const);
				const issues = rejectedIssues
					.filter(
						({ source, revision }) => currentSources.get(source) === revision && accepted.get(source) !== revision,
					)
					.map(({ source, path }) => {
						const scope = source === "home" ? "home" : source === `agent:${agentId}` ? "agent" : "candidate";
						return { scope, ...(scope !== "candidate" && path ? { path } : {}) } as const;
					});
				if (candidateState === "rejected" && !issues.length) issues.push({ scope: "candidate" });
				const acceptedHome = accepted.get("home");
				const acceptedAgent = agentId ? accepted.get(`agent:${agentId}`) : undefined;
				return {
					home: {
						state: homeState,
						revision: rootRevision.slice(0, 12),
						...(acceptedHome ? { acceptedRevision: acceptedHome.slice(0, 12) } : {}),
						file: "yonder.yaml",
					},
					candidate: {
						state: candidateState,
						revision: currentCandidate.slice(0, 12),
						...(acceptedCandidate ? { acceptedRevision: acceptedCandidate.slice(0, 12) } : {}),
					},
					...(issues.length ? { issues: issues.slice(0, 3) } : {}),
					...(agentId && agentRevision && agentState
						? {
								agent: {
									state: agentState,
									revision: agentRevision.slice(0, 12),
									...(acceptedAgent ? { acceptedRevision: acceptedAgent.slice(0, 12) } : {}),
									file: "agent.yaml",
								},
							}
						: {}),
				};
			} catch {
				let revision: string | undefined;
				try {
					revision = createHash("sha256")
						.update(await source.home.files.readFile("yonder.yaml"))
						.digest("hex");
				} catch {
					// Missing or unreadable source remains unknown; never infer an accepted snapshot.
				}
				const issues = rejectedIssues
					.filter(({ source, revision: failedRevision }) => source === "home" && revision === failedRevision)
					.slice(0, 3)
					.map(({ path }) => ({ scope: "home" as const, ...(path ? { path } : {}) }));
				const acceptedHome = accepted.get("home");
				const acceptedAgent = agentId ? accepted.get(`agent:${agentId}`) : undefined;
				const rejectedHomeRevision = revision && rejected.get("home") === revision ? revision : undefined;
				return {
					home: {
						state: rejectedHomeRevision ? "rejected" : "unknown",
						file: "yonder.yaml",
						...(rejectedHomeRevision ? { revision: rejectedHomeRevision.slice(0, 12) } : {}),
						...(acceptedHome ? { acceptedRevision: acceptedHome.slice(0, 12) } : {}),
					},
					candidate: {
						state: rejectedHomeRevision ? "rejected" : "unknown",
						...(rejectedHomeRevision ? { revision: rejectedHomeRevision.slice(0, 12) } : {}),
						...(acceptedCandidate ? { acceptedRevision: acceptedCandidate.slice(0, 12) } : {}),
					},
					...(issues.length ? { issues } : {}),
					...(agentId
						? {
								agent: {
									state: "unknown" as const,
									file: "agent.yaml",
									...(acceptedAgent ? { acceptedRevision: acceptedAgent.slice(0, 12) } : {}),
								},
							}
						: {}),
				};
			}
		},
	};
}
