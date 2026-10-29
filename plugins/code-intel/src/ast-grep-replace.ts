import { executionContext, type Tool } from "@yonder/sdk";
import { Type } from "typebox";

type Match = { file: string; text: string; replacement: string; replacementOffsets: { start: number; end: number } };
type Preview = { files: Map<string, { before: Uint8Array; after: Uint8Array }>; count: number };
const previews = new Map<string, Preview>();
type Filters = {
	insideKind?: string;
	hasKind?: string;
	hasDescendantKind?: string;
	follows?: string;
	precedes?: string;
};

function kind(field: string, value: string) {
	if (value.length > 80 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
		throw new Error(`${field} must be a single AST node kind like function_declaration`);
	return value;
}

// Structural filters need a rule document, so they run through `ast-grep scan` with an inline rule.
function inlineRule(args: Filters & { pattern: string; rewrite: string; lang: string; strictness?: string }) {
	if (args.hasKind && args.hasDescendantKind) throw new Error("hasKind and hasDescendantKind are mutually exclusive");
	const rule: Record<string, unknown> = {
		pattern: args.strictness ? { context: args.pattern, strictness: args.strictness } : args.pattern,
	};
	if (args.insideKind) rule.inside = { kind: kind("insideKind", args.insideKind), stopBy: "end" };
	if (args.hasKind) rule.has = { kind: kind("hasKind", args.hasKind) };
	if (args.hasDescendantKind) rule.has = { kind: kind("hasDescendantKind", args.hasDescendantKind), stopBy: "end" };
	if (args.follows) rule.follows = { pattern: args.follows };
	if (args.precedes) rule.precedes = { pattern: args.precedes };
	return JSON.stringify({ id: "agent-rule", language: args.lang, rule, fix: args.rewrite });
}

export const astGrepReplace: Tool = {
	name: "code-intel_ast_grep_replace",
	description: "Preview an AST rewrite; apply only the unchanged files from the latest preview in this session.",
	parameters: Type.Object(
		{
			pattern: Type.String({ minLength: 1 }),
			rewrite: Type.String(),
			lang: Type.String({ minLength: 1 }),
			paths: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })),
			strictness: Type.Optional(
				Type.Union([
					Type.Literal("smart"),
					Type.Literal("relaxed"),
					Type.Literal("ast"),
					Type.Literal("cst"),
					Type.Literal("signature"),
					Type.Literal("template"),
				]),
			),
			insideKind: Type.Optional(Type.String({ minLength: 1, description: "Ancestor AST node kind filter." })),
			hasKind: Type.Optional(Type.String({ minLength: 1, description: "Immediate child AST node kind filter." })),
			hasDescendantKind: Type.Optional(
				Type.String({ minLength: 1, description: "Recursive descendant AST node kind filter." }),
			),
			follows: Type.Optional(Type.String({ minLength: 1, description: "Preceding sibling pattern filter." })),
			precedes: Type.Optional(Type.String({ minLength: 1, description: "Following sibling pattern filter." })),
			apply: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "write", "exec"],
	async execute(value, ctx) {
		const { apply, ...args } = value as {
			pattern: string;
			rewrite: string;
			lang: string;
			paths?: string[];
			strictness?: string;
			apply?: boolean;
		} & Filters;
		const key = JSON.stringify([ctx.env.id, ctx.env.cwd, ctx.session, args]);
		const context = executionContext(ctx.signal);
		if (apply) {
			const preview = previews.get(key);
			if (!preview) throw new Error("No matching preview; preview again before applying.");
			if (!ctx.authorizeFileWrite) throw new Error("File write authorization unavailable.");
			for (const [path, file] of preview.files) {
				await ctx.authorizeFileWrite(path);
				const current = await ctx.env.readBinaryFile(path, context);
				if (!current.ok || !Buffer.from(current.value).equals(Buffer.from(file.before)))
					throw new Error(`File changed: ${path}; preview again.`);
			}
			previews.delete(key);
			for (const [path, file] of preview.files) {
				const current = await ctx.env.readBinaryFile(path, context);
				if (!current.ok || !Buffer.from(current.value).equals(Buffer.from(file.before)))
					throw new Error(`File changed: ${path}; preview again.`);
				const result = await ctx.env.writeFile(path, file.after, context);
				if (!result.ok) throw new Error(result.error.message);
			}
			return { text: `[APPLIED] ${preview.count} replacement(s)` };
		}
		previews.delete(key);
		const filtered = args.insideKind || args.hasKind || args.hasDescendantKind || args.follows || args.precedes;
		const command = filtered
			? ["ast-grep", "scan", "--inline-rules", inlineRule(args), "--json=compact"]
			: ["ast-grep", "run", "-p", args.pattern, "-r", args.rewrite, "--lang", args.lang, "--json=compact"];
		if (args.strictness && !filtered) command.push("--strictness", args.strictness);
		command.push("--", ...(args.paths?.length ? args.paths : ["."]));
		let stdout = "",
			stderr = "";
		const result = await ctx.env.exec(
			command,
			{
				cwd: ctx.env.cwd,
				timeout: 120,
				onOutput: (chunk, _context, info) => {
					if (info.stream === "stdout") stdout += chunk;
					else stderr += chunk;
				},
			},
			context,
		);
		ctx.signal.throwIfAborted();
		if (!result.ok) throw new Error(result.error.message);
		if (result.value.exitCode !== 0) throw new Error(stderr || `ast-grep exited ${result.value.exitCode}`);
		const matches = JSON.parse(stdout || "[]") as Match[];
		const files = new Map<string, { before: Uint8Array; after: Uint8Array }>();
		for (const path of new Set(matches.map((m) => m.file))) {
			const canonical = await ctx.env.canonicalPath(path, context);
			if (!canonical.ok) throw new Error(canonical.error.message);
			const content = await ctx.env.readBinaryFile(canonical.value, context);
			if (!content.ok) throw new Error(content.error.message);
			const before = Buffer.from(content.value);
			let after = before;
			for (const match of matches
				.filter((m) => m.file === path)
				.sort((a, b) => b.replacementOffsets.start - a.replacementOffsets.start)) {
				const { start, end } = match.replacementOffsets;
				if (!before.subarray(start, end).equals(Buffer.from(match.text)))
					throw new Error(`File changed: ${path}; preview again.`);
				after = Buffer.concat([after.subarray(0, start), Buffer.from(match.replacement), after.subarray(end)]);
			}
			files.set(canonical.value, { before, after });
		}
		previews.set(key, { files, count: matches.length });
		return { text: JSON.stringify({ preview: true, matches }) };
	},
};
