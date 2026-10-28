export const PLUGIN_RENAMES: ReadonlyArray<readonly [string, string]> = [
	["hermes-experience", "learning"],
	["ui-companion", "interaction"],
];
// Dash goes last so it is a literal, not a range ("@-_" would swallow "[").
const TOKEN = "A-Za-z0-9./@-";

const rules = PLUGIN_RENAMES.flatMap(([from, to]) => [
	[new RegExp(`@yonder/plugin-${from}(?![${TOKEN}])`, "gu"), `@yonder/plugin-${to}`] as const,
	// Underscore may follow (tool names such as hermes-experience_recall) but not precede.
	[new RegExp(`(?<![A-Za-z0-9./@_-])${from}(?![${TOKEN}])`, "gu"), to] as const,
]);

export function rewriteText(text: string): { text: string; count: number } {
	let count = 0;
	let result = text;
	for (const [pattern, replacement] of rules)
		result = result.replace(pattern, () => {
			count++;
			return replacement;
		});
	return { text: result, count };
}

export const shellLine = (argv: string[]) =>
	argv.map((part) => (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`)).join(" ");
