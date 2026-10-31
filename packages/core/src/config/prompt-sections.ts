import type { Profile } from "@yonder/sdk";

/**
 * Every prompt section id configuration may name, in default order (03 §5). This is a configuration key list,
 * not prompt text, so it lives at L0: config validates against it while parsing and prompt/ renders the same
 * keys. `prompt/index.test.ts` asserts it stays in step with `builtinPromptSections`.
 */
export const promptSectionIds: readonly string[] = [
	"framework",
	"common.identity",
	"common.work",
	"common.updates",
	"common.writing",
	"common.visuals",
	"common.facts",
	"common.autonomy",
	"common.authority",
	"common.voice",
	"common.assets",
	"resident.identity",
	"resident.continuity",
	"resident.relationships",
	"resident.initiative",
	"resident.work",
	"resident.growth",
	"runtime.identity",
	"runtime.events",
	"runtime.delivery",
	"runtime.environment",
	"runtime.capabilities",
	"runtime.services",
	"runtime.media",
	"runtime.delegation",
	"runtime.background",
	"runtime.discipline",
	"tool-discovery",
	"cli",
];

/** Model-facing prompt configuration issues: unknown section ids and duplicates. */
export function promptErrors(prompt: Profile["prompt"]): string[] {
	const selected = prompt?.sections ?? [];
	const ids = [...selected, ...Object.keys(prompt?.overrides ?? {})];
	return [
		...new Set(ids.filter((id) => !promptSectionIds.includes(id)).map((id) => `Unknown prompt section: ${id}`)),
		...(new Set(selected).size !== selected.length ? ["Duplicate prompt section"] : []),
	];
}
