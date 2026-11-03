import { resolve } from "node:path";
import type { Store } from "@yonder/bot-core/store/contracts";
import { type AgentConfig, resolveProfile, type YonderConfig } from "@yonder/bot-definition";
import type { Runtime, RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import {
	type Capability,
	type ContextContribution,
	intersectChannelInstances,
	intersectResources,
	type ToolResult,
	type WorkspaceResource,
} from "@yonder/sdk";

export type ProgramToolsRuntime = Pick<Runtime, "catalogProgramTools" | "programConversationId" | "callProgramTool">;
export type ProgramToolDescriptor = ReturnType<Runtime["catalogProgramTools"]>[number];

export interface ProgramToolSource {
	instance: "card";
	cloudBotId: string;
	ownerId: string;
	deviceId: string;
	platformAgentId: string;
	callerSession: string;
	invocationId: string;
	sourceMessageIds: string[];
}

export interface ProgramToolCeiling {
	capabilities: Capability[];
	channelInstances?: string[];
	resources?: WorkspaceResource[];
}

export interface ProgramToolInput {
	agent: string;
	source: ProgramToolSource;
	ceiling: ProgramToolCeiling;
	tool?: string;
	arguments?: Record<string, unknown>;
}

export interface ProgramTools {
	catalog(
		input: ProgramToolInput,
		bridgeInstance: string,
		signal: AbortSignal,
	): Promise<{ tools: ProgramToolDescriptor[] }>;
	call(input: ProgramToolInput, bridgeInstance: string, signal: AbortSignal): Promise<ToolResult>;
}

type Options = {
	agents: ReadonlyMap<string, AgentConfig>;
	config: YonderConfig;
	home: string;
	store: Store;
	version: string;
	runtime: () => ProgramToolsRuntime;
	contexts: ReadonlyMap<string, ContextContribution>;
};

export function createProgramTools({ agents, config, home, store, version, runtime, contexts }: Options): ProgramTools {
	function sessionConfig(agentId: string, ceiling: ProgramToolCeiling) {
		const agent = agents.get(agentId);
		if (!agent || agent.archivedAt || !agent.owner) throw new Error("Mapped Agent is not an active owner Agent");
		const profile = agent.profiles[agent.defaultProfile];
		const workspace = config.agents?.find((entry) => entry.id === agentId);
		if (!profile || !workspace) throw new Error("Mapped Agent accepted profile is unavailable");
		const resolved = resolveProfile(profile, agent.defaults, workspace.env ?? "local", config.defaultModel);
		resolved.capabilities = resolved.capabilities.filter((capability) => ceiling.capabilities.includes(capability));
		const channelInstances = intersectChannelInstances(resolved.channelInstances, ceiling.channelInstances);
		if (channelInstances === undefined) delete resolved.channelInstances;
		else resolved.channelInstances = channelInstances;
		if (!resolved.capabilities.length) throw new Error("No shared tool capabilities");
		return {
			agent: agentId,
			profile: agent.defaultProfile,
			cwd: resolve(home, workspace.workspace),
			resolved,
			protectedFiles: resolved.contexts
				.flatMap((id) => contexts.get(id)?.files ?? [])
				.flatMap((file) => (file.protect ? [{ path: file.path, capability: file.protect }] : [])),
			bindings: agent.bindings,
			owner: agent.owner,
		} satisfies RuntimeSessionConfig;
	}
	async function authorizedConfig(input: ProgramToolInput) {
		const base = sessionConfig(input.agent, input.ceiling);
		if (input.ceiling.resources !== undefined && !input.ceiling.resources.length)
			throw new Error("No shared device resources");
		const sourceResources = input.ceiling.resources?.filter((resource) => resource.deviceId === input.source.deviceId);
		if (input.ceiling.resources !== undefined && !sourceResources?.length)
			throw new Error("No shared device resources");
		const resources = intersectResources(
			[{ deviceId: "local", paths: [base.cwd] }],
			sourceResources?.map((resource) => ({ ...resource, deviceId: "local" })),
		);
		if (!resources?.length) throw new Error("No shared device resources");
		return { ...base, resources };
	}
	const scope = (input: ProgramToolInput, bridgeInstance: string, endpoint: string, profile: string) =>
		JSON.stringify([
			"card-program",
			bridgeInstance,
			endpoint,
			input.source.ownerId,
			input.source.deviceId,
			input.source.cloudBotId,
			input.source.callerSession,
			input.agent,
			profile,
			input.source.platformAgentId,
		]);
	function acceptedChannel(bridgeInstance: string) {
		const channel = config.channels?.[bridgeInstance];
		if (channel?.type !== "card") throw new Error("Card bridge instance is not configured on this device");
		const endpoint = "endpoint" in channel ? channel.endpoint : undefined;
		if (endpoint !== undefined && typeof endpoint !== "string") throw new Error("Card bridge endpoint is invalid");
		return new URL(endpoint ?? "https://yonderbot.net").origin;
	}
	async function programSession(input: ProgramToolInput, resolved: RuntimeSessionConfig, scopeKey: string) {
		const id = await runtime().programConversationId(scopeKey, resolved);
		const existing = await store.sessions.get(id);
		if (existing) {
			if (
				existing.agent !== input.agent ||
				existing.profile !== resolved.profile ||
				existing.mode !== "persistent" ||
				existing.key !== scopeKey ||
				existing.closed
			)
				throw new Error("Program session does not match its accepted Agent scope");
			return;
		}
		await store.sessions.put({
			id,
			agent: input.agent,
			profile: resolved.profile,
			mode: "persistent",
			key: scopeKey,
			version,
			opened: new Date().toISOString(),
		});
	}
	return {
		async catalog(input, bridgeInstance) {
			if (!bridgeInstance) throw new Error("Trusted Card bridge instance is required");
			acceptedChannel(bridgeInstance);
			const resolved = await authorizedConfig(input);
			return { tools: runtime().catalogProgramTools(resolved) };
		},
		async call(input, bridgeInstance, signal) {
			if (!bridgeInstance) throw new Error("Trusted Card bridge instance is required");
			if (!input.tool || !input.arguments) throw new Error("Tool name and arguments are required");
			const endpoint = acceptedChannel(bridgeInstance);
			const resolved = await authorizedConfig(input);
			const tools = runtime().catalogProgramTools(resolved);
			if (!tools.some((tool) => tool.name === input.tool))
				throw new Error("Tool is not available in the accepted profile");
			const scopeKey = scope(input, bridgeInstance, endpoint, resolved.profile);
			await programSession(input, resolved, scopeKey);
			return runtime().callProgramTool(
				{
					scope: scopeKey,
					invocation: input.source.invocationId,
					config: resolved,
					tool: input.tool,
					arguments: input.arguments,
				},
				signal,
			);
		},
	};
}
