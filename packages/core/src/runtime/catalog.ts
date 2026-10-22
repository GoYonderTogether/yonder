import { createCodingTools } from "@earendil-works/pi-durable/tools";
import type { Capability, Tool } from "@yonder/sdk";
import { matchesGlob } from "../config/index.js";
import { coreToolCapabilities } from "../tools/catalog.js";
import type { RuntimeSessionConfig } from "./types.js";

export const capabilityMap: Record<string, Capability[]> = {
	read: ["read"],
	write: ["write"],
	edit: ["write"],
	bash: ["exec"],
	tool_search: [],
};
export type CatalogTool = { name: string; capabilities: Capability[]; plugin?: string };
export function describeCatalog(config: RuntimeSessionConfig, catalog: CatalogTool[]) {
	const tools = catalog.map((tool) => {
		const missing = tool.capabilities.filter((capability) => !config.resolved.capabilities.includes(capability));
		const selected = !tool.plugin || config.resolved.plugins.includes(tool.plugin);
		return {
			...tool,
			missing,
			exposure: !selected
				? "plugin-not-selected"
				: missing.length
					? "capability-denied"
					: !config.agent && tool.name === "agent_ask"
						? "not-selected"
						: config.resolved.tools.offer.some((pattern) => matchesGlob(pattern, tool.name))
							? "offer"
							: config.resolved.tools.search.some((pattern) => matchesGlob(pattern, tool.name))
								? "search"
								: "not-selected",
		};
	});
	const search = tools.find((tool) => tool.name === "tool_search");
	if (search)
		search.exposure = tools.some((tool) => tool.name !== "tool_search" && tool.exposure === "search")
			? "offer"
			: "not-selected";
	return tools;
}
export function inspectToolCatalog(config: RuntimeSessionConfig, plugins: Map<string, Tool[]>) {
	return describeCatalog(config, [
		...(createCodingTools().tools ?? []).map((tool) => ({
			name: tool.name,
			capabilities: capabilityMap[tool.name] ?? [],
		})),
		...[
			...Object.entries(coreToolCapabilities),
			["grep", ["read"]] as [string, Capability[]],
			["tool_search", []] as [string, Capability[]],
		].map(([name, capabilities]) => ({ name, capabilities })),
		...[...plugins].flatMap(([plugin, tools]) =>
			tools.map((tool) => ({ name: tool.name, capabilities: tool.capabilities, plugin })),
		),
	]);
}
