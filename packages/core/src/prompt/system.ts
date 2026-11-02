import type { ContextContribution } from "@yonder/sdk";
import type { PromptPart, RuntimeSessionConfig } from "../runtime/index.js";
import { builtinPromptSections, promptSectionIds } from "./content.js";

export function framework(
	session: RuntimeSessionConfig,
	locale = "zh-CN",
	offeredTools: readonly string[] = [],
): string {
	const offered = new Set(offeredTools);
	const bindings = session.bindings?.filter((binding) => binding.profile === session.profile) ?? [];
	const noAutoReply = bindings.length > 0 && bindings.every((binding) => binding.reply === "none" && !binding.deliver);
	const delivery = noAutoReply
		? "This profile's bindings do not automatically post final text to the channel. Public messages require an available send tool."
		: "Final text follows the accepted input's delivery policy shown in <turn>; do not duplicate automatic delivery with a send tool.";
	const toolGuide = [
		offered.has("message_send") ? "Use message_send for an explicit recipient or channel." : "",
		session.agent && offered.has("agent_ask") ? "Use agent_ask to ask another agent." : "",
		offered.has("task_run") ? "Use task_run to delegate a specialized task." : "",
		offered.has("skill_view") ? "Read available skills with skill_view." : "",
	]
		.filter(Boolean)
		.join(" ");
	return `You run in Yonder Harness. Your agent ID is ${session.agent ?? "none (preset session)"}; your current profile is ${session.profile}.
Use ${locale} as the default language for user-facing responses; follow the user's language when it is clear, and do not translate skill or source text unless asked.
${delivery} ${session.agent ? "If no reply is needed, output only NO_REPLY." : "Your final report must start with STATUS: done|partial|blocked, then actual verification evidence (commands/tests/paths), remaining items, and the exact requirement if blocked. Never end a task session with empty text or NO_REPLY."}
${toolGuide}
For unfinished work, keep using available tools.${offered.has("task_continue") ? " Use task_continue to durably queue the next step before ending a progress report." : ""} A background handle already waits and delivers its result automatically; do not queue polls. A promise in prose does not schedule work. An input of type runtime.continuation is the accepted next step: execute it now.
The notice lines inside <turn> are internal information for you; do not announce them unless relevant.${session.resolved.capabilities.includes("exec") ? " Use the yonder command and yonder docs to understand and maintain your runtime environment." : ""}`;
}

export function toolDiscoveryGuide(
	tools: Array<{ name: string; plugin?: string; exposure: string }>,
): string | undefined {
	const deferred = tools.filter((tool) => tool.exposure === "search");
	if (!deferred.length) return undefined;
	const names = deferred.map((tool) => tool.name).sort();
	return `# Find tools on demand

Only the starting tools have full schemas in view. The following deferred tool names are available through tool_search; missing from the starting set does not mean missing capability:
${names.join(", ")}

For a Chinese task, identify the matching English tool name in this catalog and search that exact name. For broader discovery, use concise English action keywords; this is keyword search, not Chinese semantic search. Start with limit: 1, or up to 3 to compare related tools. Wait for the search result, then call the loaded tool in a later model response using its actual schema; do not batch the search and the deferred call together. If no match is found, retry the exact catalog name alone before reporting a missing capability. Do not invent tools or enable plugins.

Use an already offered tool directly. Discover a dedicated tool before building a shell workaround. A new run restores the starting set, so historical results do not prove a deferred tool is currently loaded.`;
}

export function promptKey(id: string): string {
	return id.toLowerCase().replace(/[^a-z0-9_-]/gu, "-");
}

export function systemPromptKeys(contexts: ReadonlyMap<string, ContextContribution>): string[] {
	return [
		...promptSectionIds.map(promptKey),
		"skills",
		...[...contexts]
			.filter(([, contribution]) => contribution.placement === "system")
			.map(([id]) => promptKey(`context.${id}`)),
	];
}

export function assembleSystemPromptParts(
	session: RuntimeSessionConfig & { id: string },
	inputs: {
		locale?: string;
		offeredTools?: string[];
		toolIndex?: string;
		skills?: string;
		contexts: PromptPart[];
	},
): PromptPart[] {
	const prompt = session.resolved.prompt ?? {};
	const sections: PromptPart[] = [];
	for (const id of prompt.sections ?? promptSectionIds) {
		if (id.startsWith("resident.") && !session.agent) continue;
		if (id === "cli" && !session.resolved.capabilities.includes("exec")) continue;
		let original =
			id === "framework"
				? framework(session, inputs.locale ?? "zh-CN", inputs.offeredTools)
				: builtinPromptSections.find((section) => section.id === id)?.text;
		if (id === "tool-discovery") {
			const guide = inputs.toolIndex;
			original = guide && !session.resolved.instructions.includes(guide) ? guide : "";
		}
		if (original === undefined) throw new Error(`Unknown prompt section: ${id}`);
		const text = prompt.overrides?.[id] ?? original;
		if (text.trim()) sections.push({ key: promptKey(id), text });
	}
	if (inputs.skills) sections.push({ key: "skills", text: inputs.skills });
	sections.push(...inputs.contexts);
	return sections;
}
