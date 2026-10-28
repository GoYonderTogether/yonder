import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";

// Listing and truncation follow pi-coding-agent's MIT-licensed core/tools/ls.js.
export function createLsTool(): Tool {
	return {
		name: "ls",
		description:
			"List directory contents, alphabetically sorted, with '/' for directories; includes dotfiles. Defaults to 500 entries or 50KB.",
		parameters: Type.Object(
			{
				path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
				limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
			},
			{ additionalProperties: false },
		),
		capabilities: ["read"],
		async execute(value, ctx) {
			const { path, limit = 500 } = value as { path?: string; limit?: number };
			const context = withAbortSignal(ctx.signal, BACKGROUND_CONTEXT);
			const dir = getOrThrow(await ctx.env.absolutePath(path || ".", context));
			const info = await ctx.env.fileInfo(dir, context);
			if (!info.ok && info.error.code === "not_found") throw new Error(`Path not found: ${dir}`);
			if (!info.ok) throw info.error;
			const target = info.value.kind === "symlink" ? getOrThrow(await ctx.env.canonicalPath(dir, context)) : dir;
			if (getOrThrow(await ctx.env.fileInfo(target, context)).kind !== "directory")
				throw new Error(`Not a directory: ${dir}`);
			const listing = await ctx.env.listDir(dir, context);
			if (!listing.ok) throw new Error(`Cannot read directory: ${listing.error.message}`);
			listing.value.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
			const entries: string[] = [];
			for (const entry of listing.value) {
				ctx.signal.throwIfAborted();
				let kind = entry.kind;
				if (kind === "symlink") {
					const canonical = await ctx.env.canonicalPath(entry.path, context);
					if (!canonical.ok) continue;
					const stat = await ctx.env.fileInfo(canonical.value, context);
					if (!stat.ok) continue;
					kind = stat.value.kind;
				}
				entries.push(entry.name + (kind === "directory" ? "/" : ""));
			}
			if (!entries.length || limit <= 0) return { text: "(empty directory)" };
			const selected = entries.slice(0, Math.ceil(limit));
			let bytes = 0;
			const shown: string[] = [];
			for (const entry of selected) {
				const size = Buffer.byteLength(entry) + (shown.length ? 1 : 0);
				if (bytes + size > 50 * 1024) break;
				bytes += size;
				shown.push(entry);
			}
			const notices: string[] = [];
			if (entries.length > selected.length)
				notices.push(`${limit} entries limit reached. Use limit=${limit * 2} for more`);
			if (shown.length < selected.length) notices.push("50KB limit reached");
			if (notices.length) {
				if (ctx.cacheToolOutput) {
					const cached = await ctx.cacheToolOutput(entries.join("\n"));
					notices.push(`Full output: ${cached}. Use read to paginate or grep to search`);
				} else notices.push("Full output cache unavailable in this environment");
			}
			return { text: shown.join("\n") + (notices.length ? `\n\n[${notices.join(". ")}]` : "") };
		},
	};
}
