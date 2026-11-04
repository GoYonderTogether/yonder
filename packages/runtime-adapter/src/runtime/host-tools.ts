import type { Tool } from "@yonder/sdk";
import type { RuntimeSessionConfig } from "../types.js";
import type { RuntimeInternals } from "./instance.js";

export const hostToolSignature = (tool: Tool) =>
	JSON.stringify({ description: tool.description, parameters: tool.parameters, capabilities: tool.capabilities });

/** One registry collection, refreshed by the host; per-run authority stays in the saved config. */
export function setHostTools(rt: RuntimeInternals, tools: Tool[]) {
	for (const tool of tools) {
		if (rt.tools.has(tool.name) && !rt.hostTools.has(tool.name))
			throw new Error(`Host tool name conflicts: ${tool.name}`);
		rt.hostTools.set(tool.name, tool);
	}
	const extension = rt.adapter("yonder.host", [...rt.hostTools.values()], []);
	rt.registry.install(extension);
	rt.extensions.set(extension.name, extension);
}

function matchesSnapshot(rt: RuntimeInternals, config: RuntimeSessionConfig, name: string) {
	const tool = rt.hostTools.get(name);
	return tool && config.hostTools?.some((entry) => entry.name === name && entry.signature === hostToolSignature(tool));
}

export function allowedHostTool(rt: RuntimeInternals, config: RuntimeSessionConfig, name: string) {
	return (
		(config.onlineHostTools === undefined || config.onlineHostTools.includes(name)) && matchesSnapshot(rt, config, name)
	);
}

export async function refreshHostTools(rt: RuntimeInternals, config: RuntimeSessionConfig, signal?: AbortSignal) {
	if (!config.hostTools?.length || !rt.options.refreshHostTools) return;
	const online = new Set(await rt.options.refreshHostTools(config, signal));
	config.onlineHostTools = config.hostTools
		.filter((tool) => online.has(tool.name) && matchesSnapshot(rt, config, tool.name))
		.map((tool) => tool.name);
}
