import type { Context } from "@earendil-works/chord";
import { type PromptInput, section, type ToolRegistration } from "@earendil-works/pi-durable";
import { SessionDoc } from "./docs.js";
import { promptParts } from "./prompt-parts.js";
import type { RuntimeOptions, RuntimeSessionConfig } from "./types.js";

/**
 * One pi section per prompt part, so a changed part patches only itself and the cached prefix survives.
 * Parts without a declared key, or out of declared order, keep the legacy single "yonder" block.
 */
export function promptSections(
	options: Pick<RuntimeOptions, "sections" | "sectionKeys">,
	config: (session: string) => RuntimeSessionConfig | undefined,
	guidelines: (name: string) => readonly string[] | undefined = () => undefined,
) {
	const keys = ["yonder", ...(options.sectionKeys ?? []).filter((key) => key !== "yonder")];
	// All sections of one render pass share the same input object; render the parts once per pass.
	const passes = new WeakMap<object, Promise<Map<string, string>>>();
	const parts = (input: PromptInput<ToolRegistration>, context: Context) => {
		let pass = passes.get(input);
		if (!pass) {
			pass = (async () => {
				await input.read.snapshot(SessionDoc, input.conversationId, context);
				const current = config(String(input.conversationId));
				if (!current) throw new Error("Missing active configuration");
				const rendered =
					(await options.sections?.({ ...current, id: String(input.conversationId) }, context.abortSignal)) ?? [];
				return promptParts(rendered, keys);
			})();
			passes.set(input, pass);
		}
		return pass;
	};
	return [
		...keys.map((key) =>
			section(key, async (input, context) => (await parts(input, context)).get(key), { tag: false }),
		),
		section(
			"yonder-tool-guidelines",
			(input) => {
				const lines = [
					...new Set(
						[...input.agent.tools]
							.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
							.flatMap((tool) => guidelines(tool.name) ?? []),
					),
				];
				return lines.length ? `Tool guidelines:\n${lines.map((line) => `- ${line}`).join("\n")}` : undefined;
			},
			{ tag: false },
		),
	];
}
