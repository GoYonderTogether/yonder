import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import {
	anchorsFor,
	clipLine,
	HASH_SEP,
	normalizeToLF,
	serveRows,
	splitLines,
	stripBom,
} from "@earendil-works/pi-durable/tools";
import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";

export type RemoteGrep = (
	args: {
		pattern: string;
		path?: string;
		literal?: boolean;
		ignoreCase?: boolean;
		glob?: string;
		context?: number;
		limit?: number;
	},
	ctx: import("@yonder/sdk").ToolContext,
) => Promise<{ text: string }>;

/** A matched line is shown as a fragment around the hit once it is longer than this; its anchor still covers it all. */
const MAX_SHOWN_LINE = 500;
/** Bounds on one call's output, so a broad pattern cannot flood the transcript. */
const MAX_OUTPUT_BYTES = 65536;
const MAX_PENDING_BYTES = 131072;

export function createGrepTool(remoteGrep: RemoteGrep): Tool {
	return {
		name: "grep",
		description:
			"Search text files. Local searches use ripgrep's Rust regex syntax (no backreferences or look-around) and respect .gitignore. Remote device searches use read-only file operations and JavaScript regex (or literal=true), with a one-second regex deadline per file; files over 512 KiB are reported as skipped. Remote ignore rules cover basic glob/negation rules in .gitignore/.ignore/.fdignore at or below the search root. Both skip .git, symlinks, hidden paths and binary files. Hits are `lineNumber:│ anchor│content`, context rows use `lineNumber-│ anchor│content`; these are served rows, editable without another read. The `=== path ===` header identifies the file. Long rows are clipped at 500 bytes but anchors cover the full line. Increase limit or narrow pattern/path when output is limited.",
		parameters: Type.Object(
			{
				pattern: Type.String(),
				path: Type.Optional(Type.String()),
				literal: Type.Optional(Type.Boolean()),
				ignoreCase: Type.Optional(Type.Boolean()),
				glob: Type.Optional(Type.String()),
				context: Type.Optional(
					Type.Integer({ minimum: 0, description: "Lines of context before and after each match" }),
				),
				limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
			},
			{ additionalProperties: false },
		),
		capabilities: ["read"],
		async execute(value, ctx) {
			const args = value as {
				pattern: string;
				path?: string;
				literal?: boolean;
				ignoreCase?: boolean;
				glob?: string;
				context?: number;
				limit?: number;
			};
			const limit = args.limit ?? 100;
			if (ctx.env.id.startsWith("device:")) return remoteGrep(args, ctx);
			const contextLines = args.context ?? 0;
			const stop = new AbortController();
			const signal = AbortSignal.any([ctx.signal, stop.signal]);
			const argv = [
				"rg",
				"--json",
				"--no-follow",
				...(contextLines > 0 ? ["--context", String(contextLines)] : []),
				...(args.literal ? ["--fixed-strings"] : []),
				...(args.ignoreCase ? ["--ignore-case"] : []),
				...(args.glob ? ["--glob", args.glob] : []),
				"--",
				args.pattern,
				args.path ?? ".",
			];
			/** Per file, in ripgrep's order: the line numbers to show, and whether each one matched. */
			const hits = new Map<string, Map<number, boolean>>();
			let pending = "",
				kept = 0,
				bytes = 0,
				truncated = false,
				cutByLimit = false;
			const result = await ctx.env.exec(
				argv,
				{
					timeout: 30,
					onOutput: async (chunk) => {
						pending += chunk;
						if (pending.length > MAX_PENDING_BYTES) {
							truncated = true;
							stop.abort();
							return;
						}
						while (pending.includes("\n")) {
							const end = pending.indexOf("\n"),
								line = pending.slice(0, end);
							pending = pending.slice(end + 1);
							let row: {
								type: string;
								data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
							};
							try {
								row = JSON.parse(line);
							} catch {
								continue;
							}
							if ((row.type !== "match" && row.type !== "context") || !row.data) continue;
							const file = row.data.path?.text,
								lineNumber = row.data.line_number;
							if (file === undefined || lineNumber === undefined) continue;
							const matched = row.type === "match";
							if (matched && kept >= limit) {
								cutByLimit = true;
								truncated = true;
								stop.abort();
								return;
							}
							bytes += file.length + (row.data.lines?.text ?? "").length;
							if (bytes > MAX_OUTPUT_BYTES) {
								truncated = true;
								stop.abort();
								return;
							}
							if (matched) kept++;
							const lines = hits.get(file) ?? new Map<number, boolean>();
							hits.set(file, lines);
							lines.set(lineNumber, matched);
						}
					},
				},
				withAbortSignal(signal, BACKGROUND_CONTEXT),
			);
			ctx.signal.throwIfAborted();
			if (!result.ok && !truncated)
				throw new Error(
					result.error.code === "spawn_error"
						? "ripgrep (rg) is unavailable in this execution environment"
						: result.error.message,
				);
			if (result.ok && result.value.exitCode > 1) throw new Error(`rg exited with ${result.value.exitCode}`);

			/** One file's rows: every shown line behind its anchor, so the row is editable without a read. */
			const rowsOf = async (file: string, lines: Map<number, boolean>): Promise<string[]> => {
				const ordered = [...lines.entries()].sort((left, right) => left[0] - right[0]);
				const width = String(ordered[ordered.length - 1]?.[0] ?? 0).length;
				const resolved = await ctx.env.absolutePath(file, BACKGROUND_CONTEXT);
				const read = resolved.ok ? await ctx.env.readTextFile(resolved.value, BACKGROUND_CONTEXT) : undefined;
				const text = read?.ok ? stripBom(read.value).text : undefined;
				if (!resolved.ok || text === undefined) {
					return ordered.map(([lineNumber, matched]) => `${lineNumber}${matched ? ":" : "-"}`);
				}
				const fileLines = splitLines(normalizeToLF(text));
				const hashes = anchorsFor(resolved.value, fileLines);
				const wanted = ordered.map(([lineNumber]) => hashes[lineNumber - 1]).filter((hash) => hash !== undefined);
				serveRows(resolved.value, hashes, fileLines, wanted);
				return ordered.map(([lineNumber, matched]) => {
					const hash = hashes[lineNumber - 1],
						content = fileLines[lineNumber - 1];
					const gutter = `${String(lineNumber).padStart(width, " ")}${matched ? ":" : "-"}${HASH_SEP}`;
					return hash === undefined || content === undefined
						? gutter
						: `${gutter} ${hash}${HASH_SEP}${clipLine(content, MAX_SHOWN_LINE)}`;
				});
			};

			const blocks: string[] = [];
			for (const [file, lines] of hits) blocks.push(`=== ${file} ===\n${(await rowsOf(file, lines)).join("\n")}`);
			const notes: string[] = [];
			if (cutByLimit) notes.push(`[grep: showing first ${limit} matches; increase limit to see more.]`);
			else if (truncated) notes.push("[grep: output truncated at 65536 bytes; narrow the pattern or path.]");
			if (blocks.length === 0) notes.push("[grep: no matches.]");
			return { text: [...blocks, ...notes].join("\n") };
		},
	};
}
