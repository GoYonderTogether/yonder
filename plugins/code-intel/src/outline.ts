import { executionContext, type Tool, type ToolContext } from "@yonder/sdk";
import { Type } from "typebox";

type Item = { range: { start: { line: number }; end: { line: number } }; members?: Item[]; [key: string]: unknown };
type File = { path: string; language: string; items: Item[] };

// Adapted from pi-lens 4.4.6, tools/ast-grep-outline, MIT; see NOTICE.
function withRead(path: string, item: Item): Item & { read: { path: string; offset: number; limit: number } } {
	return {
		...item,
		read: {
			path,
			offset: item.range.start.line + 1,
			limit: Math.max(1, item.range.end.line - item.range.start.line + 1),
		},
		...(item.members ? { members: item.members.map((member) => withRead(path, member)) } : {}),
	};
}

export const outline: Tool = {
	name: "code-intel_ast_grep_outline",
	description: "Inspect syntax-only symbols, imports, exports and members; prefer module_report when available.",
	parameters: Type.Object(
		{
			paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 }),
			lang: Type.Optional(Type.String()),
			items: Type.Optional(
				Type.Union([
					Type.Literal("auto"),
					Type.Literal("structure"),
					Type.Literal("exports"),
					Type.Literal("imports"),
					Type.Literal("all"),
				]),
			),
			view: Type.Optional(
				Type.Union([
					Type.Literal("auto"),
					Type.Literal("names"),
					Type.Literal("signatures"),
					Type.Literal("digest"),
					Type.Literal("expanded"),
				]),
			),
			type: Type.Optional(Type.Array(Type.String())),
			match: Type.Optional(Type.String()),
			pubMembers: Type.Optional(Type.Boolean()),
			globs: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "exec"],
	async execute(value, ctx: ToolContext) {
		const p = value as {
			paths: string[];
			lang?: string;
			items?: string;
			view?: string;
			type?: string[];
			match?: string;
			pubMembers?: boolean;
			globs?: string[];
		};
		const args = ["ast-grep", "outline", "--json=compact", "--color", "never"];
		for (const [flag, value] of [
			["--lang", p.lang],
			["--items", p.items],
			["--view", p.view],
			["--type", p.type?.join(",")],
			["--match", p.match],
		] as [string, string | undefined][])
			if (value) args.push(flag, value);
		if (p.pubMembers) args.push("--pub-members");
		for (const glob of p.globs ?? []) args.push("--globs", glob);
		args.push("--", ...p.paths);
		let stdout = "",
			stderr = "";
		const result = await ctx.env.exec(
			args,
			{
				cwd: ctx.env.cwd,
				timeout: 120,
				onOutput: (chunk, _context, info) => {
					if (info.stream === "stdout") stdout += chunk;
					else stderr += chunk;
				},
			},
			executionContext(ctx.signal),
		);
		ctx.signal.throwIfAborted();
		if (!result.ok)
			throw new Error(
				result.error.code === "spawn_error"
					? "ast-grep CLI not found; install @ast-grep/cli 0.51.0 in this environment."
					: result.error.message,
			);
		if (result.value.exitCode !== 0)
			throw new Error(`ast-grep outline exited ${result.value.exitCode}: ${stderr || stdout}`);
		const files = JSON.parse(stdout) as File[];
		if (!files.length) return { text: "No outline items found (syntax-only; try module_report, or check lang/paths)." };
		const selected = files.slice(0, 50).map((file) => ({
			path: file.path,
			language: file.language,
			items: file.items.slice(0, 200).map((item) => withRead(file.path, item)),
			...(file.items.length > 200 ? { truncatedItems: file.items.length - 200 } : {}),
		}));
		return {
			text: JSON.stringify({ outline: selected, ...(files.length > 50 ? { truncatedFiles: files.length - 50 } : {}) }),
		};
	},
};
