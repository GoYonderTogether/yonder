import { executionContext, type Tool } from "@yonder/sdk";
import { Type } from "typebox";

type Match = { file: string; text: string; replacement: string; replacementOffsets: { start: number; end: number } };
type Preview = { files: Map<string, { before: Uint8Array; after: Uint8Array }>; count: number };
const previews = new Map<string, Preview>();

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
		};
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
		const command = ["ast-grep", "run", "-p", args.pattern, "-r", args.rewrite, "--lang", args.lang, "--json=compact"];
		if (args.strictness) command.push("--strictness", args.strictness);
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
