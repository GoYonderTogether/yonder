import { createHash } from "node:crypto";
import { executionSources } from "@yonder/bot-core/sessions/execution-source";
import type { Store } from "@yonder/bot-core/store/contracts";
import type { AgentConfig } from "@yonder/bot-definition";
import type { Runtime, RuntimeSessionConfig } from "@yonder/runtime-adapter";
import type { Capability, Tool, ToolContext, ToolResult, TSchema, YEvent } from "@yonder/sdk";

type Device = { deviceId: string; name: string; agents: Array<{ platformAgentId: string; name: string }> };
type Descriptor = {
	name: string;
	description: string;
	parameters: TSchema;
	capabilities: Capability[];
	guidelines?: string[];
	exposure: "offer" | "search";
};
type Target = { deviceId: string; platformAgentId: string; tool: string };

/** The service client narrows each real run; it never supplies an owner, profile or local mapping key. */
export function createDeviceTools(options: {
	endpoint: string;
	token: string;
	botId: string;
	store: Store;
	agents: Map<string, AgentConfig>;
	runtime(): Runtime;
}) {
	const targets = new Map<string, Target>();
	const { store, agents } = options;
	async function request<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
		const response = await fetch(`${options.endpoint}${path}`, {
			method: "POST",
			headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" },
			body: JSON.stringify(body),
			...(signal ? { signal } : {}),
		});
		const data = (await response.json()) as { ok: boolean; result?: T; error?: { code?: string; message?: string } };
		if (!response.ok || !data.ok || data.result === undefined)
			// Keep the protocol code: `unsupported` is an answer about the device, not a failure of the call.
			throw Object.assign(new Error(data.error?.message ?? `Device RPC HTTP ${response.status}`), {
				code: data.error?.code,
			});
		return data.result;
	}
	const base = `/api/worker/bots/${encodeURIComponent(options.botId)}`;
	async function sources(config: RuntimeSessionConfig, inputs: YEvent[]) {
		if (!config.sessionId) return;
		const leaves = await executionSources(store, agents, {
			session: config.sessionId,
			agent: config.agent,
			profile: config.profile,
			inputs: inputs.map((event) => event.id),
		});
		if (
			!leaves?.length ||
			leaves.some((event) => !event.conv?.startsWith("conv:card:") || !(event.data as { msgId?: string }).msgId)
		)
			return;
		return leaves.map((event) => (event.data as { msgId: string }).msgId);
	}
	const ceiling = (config: RuntimeSessionConfig) => ({
		capabilities: config.resolved.capabilities,
		...(config.resolved.channelInstances ? { channelInstances: config.resolved.channelInstances } : {}),
		...(config.resources ? { resources: config.resources } : {}),
	});
	async function catalog(config: RuntimeSessionConfig, sourceMessageIds: string[], signal?: AbortSignal) {
		const { devices } = await request<{ devices: Device[] }>(`${base}/devices`, { sourceMessageIds }, signal);
		const entries: Array<{
			tool: Tool;
			target: Target;
			exposure: Descriptor["exposure"];
			device: string;
			agent: string;
		}> = [];
		for (const device of devices)
			for (const agent of device.agents) {
				if (config.resources?.length && !config.resources.some((resource) => resource.deviceId === device.deviceId))
					continue;
				let tools: Descriptor[];
				try {
					({ tools } = await request<{ tools: Descriptor[] }>(
						`${base}/devices/${encodeURIComponent(device.deviceId)}/work/rpc/tools.catalog`,
						{
							platformAgentId: agent.platformAgentId,
							sourceMessageIds,
							callerSession: config.sessionId,
							invocationId: `catalog:${config.sessionId}`,
							ceiling: ceiling(config),
						},
						signal,
					));
				} catch (error) {
					// A harness device provides sessions, not device tools (23 §1). One such device must not
					// remove every other device's tools from this run; a real failure still surfaces.
					if ((error as { code?: unknown }).code === "unsupported") continue;
					throw error;
				}
				for (const descriptor of tools) {
					if (descriptor.capabilities.some((capability) => !config.resolved.capabilities.includes(capability)))
						continue;
					const target = { deviceId: device.deviceId, platformAgentId: agent.platformAgentId, tool: descriptor.name };
					const namespace = createHash("sha256").update(JSON.stringify(target)).digest("hex").slice(0, 16);
					const name = `device_${namespace}_${descriptor.name}`.slice(0, 64);
					const tool: Tool = {
						name,
						description: `${device.name} / ${agent.name}: ${descriptor.description}`,
						parameters: descriptor.parameters,
						capabilities: descriptor.capabilities,
						...(descriptor.guidelines ? { guidelines: descriptor.guidelines } : {}),
						execute: (args, ctx) => call(name, args as Record<string, unknown>, ctx),
					};
					entries.push({ tool, target, exposure: descriptor.exposure, device: device.name, agent: agent.name });
				}
			}
		return entries;
	}
	async function call(name: string, args: Record<string, unknown>, supplied: ToolContext): Promise<ToolResult> {
		const runtime = options.runtime();
		const ctx = await runtime.invocationContext(supplied);
		const config = await runtime.invocationConfig(supplied);
		const target = targets.get(name);
		if (!target || !config.hostTools?.some((entry) => entry.name === name))
			return { text: "Device tool is outside this run's frozen authority", isError: true };
		const sourceMessageIds = await sources({ ...config, sessionId: ctx.session }, ctx.events ?? []);
		if (!sourceMessageIds) return { text: "Device tools require verified owner DM sources", isError: true };
		return request<ToolResult>(
			`${base}/devices/${encodeURIComponent(target.deviceId)}/work/rpc/tools.call`,
			{
				platformAgentId: target.platformAgentId,
				sourceMessageIds,
				callerSession: ctx.session,
				invocationId: runtime.invocationId(supplied),
				ceiling: ceiling(config),
				tool: target.tool,
				arguments: args,
			},
			ctx.signal,
		);
	}
	const signature = (tool: Tool) =>
		JSON.stringify({ description: tool.description, parameters: tool.parameters, capabilities: tool.capabilities });
	return {
		async resolve(config: RuntimeSessionConfig, inputs: YEvent[] = []) {
			const sourceMessageIds = await sources(config, inputs);
			if (!sourceMessageIds) return { ...config, hostTools: [] };
			const entries = await catalog(config, sourceMessageIds);
			for (const entry of entries) targets.set(entry.tool.name, entry.target);
			options.runtime().setHostTools(entries.map((entry) => entry.tool));
			const resolved = structuredClone(config.resolved);
			for (const { tool, exposure } of entries) resolved.tools[exposure].push(tool.name);
			return {
				...config,
				resolved,
				hostToolInputs: inputs.map((event) => event.id),
				hostTools: entries.map(({ tool }) => ({
					name: tool.name,
					signature: signature(tool),
					capabilities: tool.capabilities,
				})),
				hostFacts: JSON.stringify({
					runToolHostSnapshot: entries.map(({ device, agent, tool }) => ({ device, agent, tool: tool.name })),
				}),
			};
		},
		async refresh(config: RuntimeSessionConfig, signal?: AbortSignal) {
			if (!config.sessionId || !config.hostTools?.length) return [];
			const current = (await Promise.all((config.hostToolInputs ?? []).map((id) => store.events.get(id)))).filter(
				(event): event is YEvent => event !== undefined,
			);
			const sourceMessageIds = await sources(config, current);
			if (!sourceMessageIds) return [];
			const entries = await catalog(config, sourceMessageIds, signal);
			const allowed = entries.filter(({ tool }) =>
				config.hostTools?.some((saved) => saved.name === tool.name && saved.signature === signature(tool)),
			);
			config.hostFacts = JSON.stringify({
				runToolHostSnapshot: allowed.map(({ device, agent, tool }) => ({ device, agent, tool: tool.name })),
			});
			return allowed.map(({ tool }) => tool.name);
		},
	};
}
