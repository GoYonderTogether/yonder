#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

export const MAPPINGS = [
	["packages/execution-protocol", "packages/protocol"],
	["packages/executor", "packages/device"],
	["@yonder/execution-protocol", "@yonder/protocol"],
	["@yonder/plugin-hermes-experience", "@yonder/plugin-learning"],
	["@yonder/plugin-ui-companion", "@yonder/plugin-interaction"],
	["@yonder/executor", "@yonder/device"],
	["hermes-experience", "learning"],
	["ui-companion", "interaction"],
	["yonder-harness", "yonder"],
	["~/.local/share/yonder-harness", "~/.local/share/yonder"],
	["dev.yonder.harness.power", "dev.yonder.power"],
];

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "pi-durable"]);
const SKIP_FILES = new Set(["archive.md", "CHANGELOG", "CHANGELOG.md"]);
const TEXT_EXTENSIONS = new Set([
	".json",
	".jsonc",
	".ts",
	".tsx",
	".js",
	".mjs",
	".cjs",
	".md",
	".yaml",
	".yml",
	".toml",
	".sh",
	".swift",
	".plist",
	".xml",
	".txt",
	".html",
	".css",
]);

// Paths whose old names are intentional: migration code (reads the OLD paths), this codemod and its test,
// historical verification evidence, the deprecated hermes-experience alias package and the vendored pi fork.
const SKIP_PREFIXES = [
	"packages/cli/src/migrate",
	"scripts/migrate/",
	"docs/verification/",
	"plugins/hermes-experience/",
	"third_party/",
];
// Literals that must survive: the GitHub repo is not renamed yet, local checkout paths and the alias package stay.
const PROTECTED = [
	"GoYonderTogether/yonder-harness",
	"Documents/yonder-harness",
	"cd yonder-harness",
	"@yonder/plugin-hermes-experience",
	"plugins/hermes-experience",
];

function shouldSkip(relative) {
	const parts = relative.split(path.sep);
	return (
		parts.some((part) => SKIP_DIRS.has(part)) ||
		relative === "docs/archive.md" ||
		SKIP_PREFIXES.some((prefix) => relative.startsWith(prefix)) ||
		/(^|\/)CHANGELOG(?:\.[^/]*)?$/.test(relative) ||
		SKIP_FILES.has(path.basename(relative))
	);
}
function transform(source) {
	let result = source;
	PROTECTED.forEach((literal, i) => {
		result = result.split(literal).join(`\u0000${i}\u0000`);
	});
	for (const [oldName, newName] of MAPPINGS) {
		const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		result = result.replace(new RegExp(escaped, "g"), newName);
	}
	PROTECTED.forEach((literal, i) => {
		result = result.split(`\u0000${i}\u0000`).join(literal);
	});
	return result;
}
function walk(root, current = root) {
	const output = [];
	for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
		const full = path.join(current, entry.name);
		const relative = path.relative(root, full);
		if (shouldSkip(relative)) continue;
		if (entry.isDirectory()) output.push(...walk(root, full));
		else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) output.push(full);
	}
	return output;
}
export function migrate(root, { apply = false } = {}) {
	const changes = [];
	const ambiguous = [];
	for (const file of walk(root)) {
		const before = fs.readFileSync(file, "utf8");
		const after = transform(before);
		if (before !== after) {
			const count = MAPPINGS.reduce((sum, [oldName]) => sum + before.split(oldName).length - 1, 0);
			changes.push({ file: path.relative(root, file), count });
			if (apply) fs.writeFileSync(file, after);
		}
		if (/\\b(?:harness|being|card-web|Net)\\b/i.test(before)) ambiguous.push(path.relative(root, file));
	}
	return { changes, ambiguous };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const mode = process.argv[2];
	if (!["--dry-run", "--apply"].includes(mode) || process.argv.length > 3) {
		console.error("Usage: node scripts/migrate/rename-yonder.mjs --dry-run|--apply [root]");
		process.exitCode = 2;
	} else {
		const root = path.resolve(process.argv[3] ?? process.cwd());
		const result = migrate(root, { apply: mode === "--apply" });
		for (const change of result.changes)
			console.log(`${mode === "--dry-run" ? "would change" : "changed"}: ${change.file} (${change.count})`);
		for (const file of result.ambiguous) console.log(`ambiguous: ${file}`);
		console.log(
			`Summary: ${result.changes.length} files, ${result.changes.reduce((n, item) => n + item.count, 0)} replacements; ${result.ambiguous.length} ambiguous files.`,
		);
	}
}
