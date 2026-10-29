/** Minimal `.gitignore` subset for skill discovery: no dependency, last matching rule wins. */
export interface IgnoreRule {
	negated: boolean;
	dirOnly: boolean;
	regex: RegExp;
	segments: boolean;
}

export const ignoreFileNames = [".gitignore", ".ignore", ".fdignore"];

function toRegExp(pattern: string): RegExp {
	let source = "";
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index]!;
		if (char === "*") {
			if (pattern[index + 1] === "*") {
				source += ".*";
				index++;
				if (pattern[index + 1] === "/") index++;
			} else source += "[^/]*";
		} else if (char === "?") source += "[^/]";
		else source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	}
	return new RegExp(`^${source}$`, "u");
}

/** Rules from one ignore file; `prefix` is the owning directory relative to the discovery root. */
export function addIgnoreRules(rules: IgnoreRule[], text: string, prefix: string): void {
	for (const line of text.split(/\r?\n/u)) {
		const trimmed = line.trim();
		if (!trimmed || (trimmed.startsWith("#") && !trimmed.startsWith("\\#"))) continue;
		let pattern = trimmed;
		let negated = false;
		if (pattern.startsWith("!")) {
			negated = true;
			pattern = pattern.slice(1);
		} else if (pattern.startsWith("\\!")) pattern = pattern.slice(1);
		const dirOnly = pattern.endsWith("/");
		if (dirOnly) pattern = pattern.slice(0, -1);
		if (pattern.startsWith("/")) pattern = pattern.slice(1);
		if (!pattern) continue;
		const prefixed = prefix ? `${prefix}${pattern}` : pattern;
		rules.push({ negated, dirOnly, regex: toRegExp(prefixed), segments: !prefixed.includes("/") });
	}
}

function matchesAncestors(rule: IgnoreRule, path: string): boolean {
	for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1))
		if (rule.regex.test(path.slice(0, index))) return true;
	return false;
}

function matchesPath(rule: IgnoreRule, path: string): boolean {
	if (rule.segments) return path.split("/").some((segment) => rule.regex.test(segment));
	return rule.regex.test(path) || matchesAncestors(rule, path);
}
export function ignored(rules: readonly IgnoreRule[], path: string, directory: boolean): boolean {
	let result = false;
	for (const rule of rules) {
		// A directory-only rule never excludes a file of that name; it excludes the directory and its contents.
		const hit = rule.dirOnly
			? matchesAncestors(rule, path) || (directory && rule.regex.test(path))
			: matchesPath(rule, path);
		if (hit) result = !rule.negated;
	}
	return result;
}
