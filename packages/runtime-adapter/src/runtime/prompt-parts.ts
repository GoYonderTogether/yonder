import type { PromptPart } from "./types.js";

/**
 * Map rendered prompt parts onto declared section keys. `keys[0]` is the legacy block: when any part is unkeyed,
 * undeclared, repeated or out of declared order, every part is joined into it so the rendered text stays identical.
 */
export function promptParts(parts: ReadonlyArray<string | PromptPart>, keys: readonly string[]): Map<string, string> {
	const position = new Map(keys.map((key, index) => [key, index]));
	let last = 0;
	const keyed = new Map<string, string>();
	for (const part of parts) {
		const at = typeof part === "string" ? undefined : position.get(part.key);
		if (typeof part === "string" || at === undefined || at <= last) {
			const text = parts.map((item) => (typeof item === "string" ? item : item.text)).join("\n\n");
			return new Map(text ? [[keys[0]!, text]] : []);
		}
		last = at;
		keyed.set(part.key, part.text);
	}
	return keyed;
}
