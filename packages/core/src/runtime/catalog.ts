import { createCodingTools } from "@earendil-works/pi-durable/tools";
import type { Capability, Tool } from "@yonder/sdk";
import { matchesGlob } from "../config/index.js";
import { coreToolCapabilities } from "../tools/catalog.js";
import type { RuntimeSessionConfig } from "./types.js";

export const capabilityMap: Record<string, Capability[]> = {
	read: ["read"],
	write: ["write"],
	edit: ["write"],
	replace: ["write"],
	replace_match: ["write"],
	insert: ["write"],
	copy: ["write"],
	move: ["write"],
	undo_last_change: ["write"],
	bash: ["exec"],
	tool_search: [],
};
export type CatalogTool = { name: string; capabilities: Capability[]; plugin?: string };
const mainOnlyByDefault = new Set(["session_list", "session_read"]);
/** Optional workbench tools (contracts §18): a wildcard never offers them, only their full name does. */
const explicitOnly = new Set(["session_archive", "session_hand_up", "bot_ask", "bot_request", "bot_attach"]);
export function describeCatalog(config: RuntimeSessionConfig, catalog: CatalogTool[]) {
	const tools = catalog.map((tool) => {
		const missing = tool.capabilities.filter((capability) => !config.resolved.capabilities.includes(capability));
		const selected = !tool.plugin || config.resolved.plugins.includes(tool.plugin);
		const explicit =
			!tool.plugin &&
			(explicitOnly.has(tool.name) ||
				(config.agent !== null && config.agent !== "main" && mainOnlyByDefault.has(tool.name)));
		const matchesCeilings = (kind: "offer" | "search") =>
			(config.resolved.delegationCeilings ?? []).every((ceiling) =>
				ceiling.explicitSessionTools && !tool.plugin && mainOnlyByDefault.has(tool.name)
					? ceiling.tools[kind].includes(tool.name)
					: ceiling.tools[kind].some((pattern) => matchesGlob(pattern, tool.name)),
			);
		const offered =
			matchesCeilings("offer") &&
			(explicit
				? config.resolved.tools.offer.includes(tool.name)
				: config.resolved.tools.offer.some((pattern) => matchesGlob(pattern, tool.name)));
		const searched =
			matchesCeilings("search") &&
			(explicit
				? config.resolved.tools.search.includes(tool.name)
				: config.resolved.tools.search.some((pattern) => matchesGlob(pattern, tool.name)));
		return {
			...tool,
			missing,
			exposure: !selected
				? "plugin-not-selected"
				: missing.length
					? "capability-denied"
					: !config.agent && tool.name === "agent_ask"
						? "not-selected"
						: offered
							? "offer"
							: searched
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
			["find", ["read"]] as [string, Capability[]],
			["ls", ["read"]] as [string, Capability[]],
			["tool_search", []] as [string, Capability[]],
		].map(([name, capabilities]) => ({ name, capabilities })),
		...[...plugins].flatMap(([plugin, tools]) =>
			tools.map((tool) => ({ name: tool.name, capabilities: tool.capabilities, plugin })),
		),
	]);
}
