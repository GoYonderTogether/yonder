import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";

// Search behavior follows pi-coding-agent's MIT-licensed core/tools/find.js.
export function createFindTool(): Tool {
	return {
		name: "find",
		description:
			"Search by glob, respecting .gitignore and including hidden files. Paths are relative to the search directory. Defaults to 1000 results or 50KB.",
		parameters: Type.Object(
			{
				pattern: Type.String({ minLength: 1, description: "Glob pattern, e.g. '*.ts' or 'src/**/*.ts'" }),
				path: Type.Optional(Type.String({ description: "Directory to search (default: current directory)" })),
				limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum results (default: 1000)" })),
			},
			{ additionalProperties: false },
		),
		capabilities: ["read"],
		async execute(value, ctx) {
			const { pattern, path, limit = 1000 } = value as { pattern: string; path?: string; limit?: number };
			const context = withAbortSignal(ctx.signal, BACKGROUND_CONTEXT);
			const dir = getOrThrow(await ctx.env.absolutePath(path || ".", context));
			const info = await ctx.env.fileInfo(dir, context);
			if (!info.ok && info.error.code === "not_found") throw new Error(`Path not found: ${dir}`);
			if (!info.ok) throw info.error;
			let insideGitRepo = false;
			for (let current = dir; ; ) {
				if (getOrThrow(await ctx.env.exists(getOrThrow(await ctx.env.joinPath([current, ".git"], context)), context))) {
					insideGitRepo = true;
					break;
				}
				const parent = getOrThrow(await ctx.env.joinPath([current, ".."], context));
				if (parent === current) break;
				current = parent;
			}
			const fullPath = pattern.includes("/");
			const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(dir);
			let effectivePattern =
				fullPath && !pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**"
					? `**/${pattern}`
					: pattern;
			if (windows && fullPath) effectivePattern = effectivePattern.replaceAll("/", String.raw`[/\\]`);
			const args = [
				"--glob",
				"--color=never",
				"--hidden",
				...(insideGitRepo ? [] : ["--no-require-git"]),
				"--max-results",
				String(limit),
				...(fullPath ? ["--full-path"] : []),
				"--",
				effectivePattern,
				dir,
			];
			let output = "",
				error = "";
			let result: Awaited<ReturnType<typeof ctx.env.exec>> | undefined;
			for (const command of ["fd", "fdfind"]) {
				result = await ctx.env.exec(
					[command, ...args],
					{
						cwd: dir,
						onOutput: (chunk, _context, info) => {
							if (info.stream === "stdout") output += chunk;
							else error += chunk;
						},
					},
					context,
				);
				if (result.ok || result.error.code !== "spawn_error") break;
			}
			ctx.signal.throwIfAborted();
			if (!result?.ok)
				throw new Error(
					result?.error.code === "spawn_error"
						? "fd is unavailable in this execution environment; install fd or fdfind"
						: (result?.error.message ?? "Unable to run fd"),
				);
			if (result.value.exitCode !== 0 && !output)
				throw new Error(error.trim() || `fd exited with ${result.value.exitCode}`);
			const entries = output
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					const name = windows ? line.replaceAll("\\", "/") : line;
					const root = (windows ? dir.replaceAll("\\", "/") : dir).replace(/\/$/, "");
					return name.startsWith(`${root}/`) ? name.slice(root.length + 1) : name.replace(/^\.\//, "");
				});
			if (!entries.length) return { text: "No files found matching pattern" };
			const shown: string[] = [];
			let bytes = 0;
			for (const entry of entries) {
				const size = Buffer.byteLength(entry) + (shown.length ? 1 : 0);
				if (bytes + size > 50 * 1024) break;
				bytes += size;
				shown.push(entry);
			}
			const notices: string[] = [];
			if (entries.length >= limit)
				notices.push(`${limit} results limit reached. Use limit=${limit * 2} for more, or refine pattern`);
			if (shown.length < entries.length) notices.push("50KB limit reached");
			if (notices.length && ctx.cacheToolOutput)
				notices.push(
					`Acquired output: ${await ctx.cacheToolOutput(entries.join("\n"))}. Use read to paginate or grep to search`,
				);
			else if (notices.length) notices.push("Acquired output cache unavailable in this environment");
			return { text: shown.join("\n") + (notices.length ? `\n\n[${notices.join(". ")}]` : "") };
		},
	};
}
