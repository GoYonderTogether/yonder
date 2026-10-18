import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";

export function createGrepTool(): Tool {
	return {
		name: "grep",
		description:
			"Search files with ripgrep; returns file, line and matching text. Paths follow read permissions; symbolic links are not followed.",
		parameters: Type.Object(
			{
				pattern: Type.String(),
				path: Type.Optional(Type.String()),
				literal: Type.Optional(Type.Boolean()),
				ignoreCase: Type.Optional(Type.Boolean()),
				glob: Type.Optional(Type.String()),
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
				limit?: number;
			};
			const limit = args.limit ?? 100,
				stop = new AbortController();
			const signal = AbortSignal.any([ctx.signal, stop.signal]);
			const argv = [
				"rg",
				"--json",
				"--no-follow",
				...(args.literal ? ["--fixed-strings"] : []),
				...(args.ignoreCase ? ["--ignore-case"] : []),
				...(args.glob ? ["--glob", args.glob] : []),
				"--",
				args.pattern,
				args.path ?? ".",
			];
			let output = "",
				pending = "",
				truncated = false;
			const matches: Array<{ file: string; line: number; text: string }> = [];
			const result = await ctx.env.exec(
				argv,
				{
					timeout: 30,
					onOutput: async (chunk) => {
						pending += chunk;
						if (pending.length > 131072) {
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
								output += line.slice(0, 4096);
								continue;
							}
							if (row.type !== "match" || !row.data) continue;
							if (matches.length >= limit || output.length > 65536) {
								truncated = true;
								stop.abort();
								return;
							}
							const match = {
								file: row.data.path?.text ?? "[non-UTF8 path]",
								line: row.data.line_number ?? 0,
								text: (row.data.lines?.text ?? "").trimEnd().slice(0, 8192),
							};
							matches.push(match);
							output += match.text;
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
			if (result.ok && result.value.exitCode > 1) throw new Error(output || `rg exited with ${result.value.exitCode}`);
			return { text: JSON.stringify({ matches, truncated }) };
		},
	};
}
