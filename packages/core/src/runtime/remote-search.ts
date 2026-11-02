import { posix } from "node:path";
import { Worker } from "node:worker_threads";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { type FileInfo, getOrThrow } from "@earendil-works/pi-durable/env";
import {
	anchorsFor,
	clipLine,
	HASH_SEP,
	normalizeToLF,
	serveRows,
	splitLines,
	stripBom,
} from "@earendil-works/pi-durable/tools";
import type { ToolContext } from "@yonder/sdk";
import { addIgnoreRules, type IgnoreRule, ignored } from "../skills/ignore.js";

const contextOf = (ctx: ToolContext) => withAbortSignal(ctx.signal, BACKGROUND_CONTEXT);
const normalized = (path: string) => path.replaceAll("\\", "/");
const globMatches = (path: string, pattern: string) =>
	posix.matchesGlob(pattern.includes("/") ? path : posix.basename(path), pattern);

/** Never traverses a symlink or reads outside the remote executor's existing grants. */
async function* entries(
	ctx: ToolContext,
	path: string,
	hidden: boolean,
): AsyncGenerator<{ info: FileInfo; relative: string }> {
	const context = contextOf(ctx);
	const root = getOrThrow(await ctx.env.canonicalPath(getOrThrow(await ctx.env.absolutePath(path, context)), context));
	const stat = getOrThrow(await ctx.env.fileInfo(root, context));
	if (stat.kind === "file") {
		yield { info: stat, relative: stat.name };
		return;
	}
	let visited = 0;
	async function* walk(
		dir: string,
		prefix: string,
		inherited: IgnoreRule[],
	): AsyncGenerator<{ info: FileInfo; relative: string }> {
		ctx.signal.throwIfAborted();
		const children = getOrThrow(await ctx.env.listDir(dir, context));
		const rules = [...inherited];
		for (const entry of children) {
			if (![".gitignore", ".ignore", ".fdignore"].includes(entry.name) || entry.kind !== "file") continue;
			addIgnoreRules(rules, getOrThrow(await ctx.env.readTextFile(entry.path, context)), prefix);
		}
		for (const info of children) {
			ctx.signal.throwIfAborted();
			if (++visited > 10000) throw new Error("Remote search exceeded 10000 entries; narrow path.");
			if (info.name === ".git" || info.kind === "symlink" || (!hidden && info.name.startsWith("."))) continue;
			const relative = `${prefix}${info.name}`;
			if (ignored(rules, relative, info.kind === "directory")) continue;
			yield { info, relative };
			if (info.kind === "directory") yield* walk(info.path, `${relative}/`, rules);
		}
	}
	yield* walk(root, "", []);
}

export async function remoteFind(args: { pattern: string; path?: string; limit?: number }, ctx: ToolContext) {
	const limit = args.limit ?? 1000;
	const shown: string[] = [];
	let bytes = 0;
	let cut = false;
	for await (const { info, relative } of entries(ctx, args.path ?? ".", true)) {
		if (!globMatches(relative, args.pattern)) continue;
		const name = relative + (info.kind === "directory" ? "/" : "");
		const size = Buffer.byteLength(name) + 1;
		if (shown.length >= limit || bytes + size > 50 * 1024) {
			cut = true;
			break;
		}
		shown.push(name);
		bytes += size;
	}
	return {
		text:
			(shown.join("\n") || "No files found matching pattern") +
			(cut ? "\n[find: output limited; increase limit or narrow path.]" : ""),
	};
}

const MATCH_WORKER = `const {parentPort,workerData:a}=require('node:worker_threads');
try {const regex=a.literal?undefined:new RegExp(a.pattern,a.ignoreCase?'iu':'u');
const needle=a.ignoreCase?a.pattern.toLocaleLowerCase():a.pattern;const hits=[];
for(let i=0;i<a.lines.length;i++){const line=a.lines[i];if(regex?regex.test(line):(a.ignoreCase?line.toLocaleLowerCase():line).includes(needle)){hits.push(i);if(hits.length>a.limit)break;}}
parentPort.postMessage({hits});}catch(error){parentPort.postMessage({error:error.message});}`;

/** Bound JS regex execution off the runtime event loop; remote search does not claim Rust regex syntax. */
async function matchingLines(lines: string[], args: GrepArgs, signal: AbortSignal): Promise<number[]> {
	signal.throwIfAborted();
	const worker = new Worker(MATCH_WORKER, { eval: true, workerData: { ...args, lines } });
	try {
		return await new Promise<number[]>((resolve, reject) => {
			const finish = (error?: unknown, hits?: number[]) => {
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(hits ?? []);
			};
			const abort = () => finish(signal.reason ?? new Error("Search cancelled"));
			const timer = setTimeout(
				() => finish(new Error("Remote regex exceeded 1 second; simplify pattern or use literal=true.")),
				1000,
			);
			signal.addEventListener("abort", abort, { once: true });
			worker.once("error", (error) => finish(error));
			worker.once("message", (value: { error?: string; hits?: number[] }) =>
				finish(value.error ? new Error(value.error) : undefined, value.hits),
			);
		});
	} finally {
		await worker.terminate();
	}
}

interface GrepArgs {
	pattern: string;
	path?: string;
	literal?: boolean;
	ignoreCase?: boolean;
	glob?: string;
	context?: number;
	limit?: number;
}
export async function remoteGrep(args: GrepArgs, ctx: ToolContext) {
	const context = contextOf(ctx);
	const limit = args.limit ?? 100;
	const blocks: string[] = [];
	const notes: string[] = [];
	let kept = 0,
		bytes = 0,
		skipped = 0;
	for await (const { info, relative } of entries(ctx, args.path ?? ".", false)) {
		if (info.kind !== "file" || (args.glob && !globMatches(relative, args.glob))) continue;
		if (info.size > 512 * 1024) {
			skipped++;
			continue;
		}
		const text = getOrThrow(await ctx.env.readTextFile(info.path, context));
		if (text.includes("\0")) continue;
		const lines = splitLines(normalizeToLF(stripBom(text).text));
		const hits = await matchingLines(lines, { ...args, limit: limit - kept }, ctx.signal);
		if (!hits.length) continue;
		const selected = new Map<number, boolean>();
		for (const hit of hits.slice(0, limit - kept)) {
			for (
				let i = Math.max(0, hit - (args.context ?? 0));
				i <= Math.min(lines.length - 1, hit + (args.context ?? 0));
				i++
			)
				selected.set(i, selected.get(i) === true || i === hit);
		}
		const path = getOrThrow(await ctx.env.canonicalPath(info.path, context));
		const hashes = anchorsFor(path, lines);
		const rows: string[] = [];
		const served: string[] = [];
		for (const [index, matched] of [...selected].sort((a, b) => a[0] - b[0])) {
			const row = `${index + 1}${matched ? ":" : "-"}${HASH_SEP} ${hashes[index]}${HASH_SEP}${clipLine(lines[index]!, 500)}`;
			const size = Buffer.byteLength(row) + 1;
			if (bytes + size > 65536) {
				notes.push("[grep: output truncated at 65536 bytes; narrow pattern or path.]");
				break;
			}
			bytes += size;
			rows.push(row);
			served.push(hashes[index]!);
		}
		serveRows(path, hashes, lines, served);
		if (rows.length) blocks.push(`=== ${normalized(path)} ===\n${rows.join("\n")}`);
		kept += hits.length;
		if (notes.length) break;
		if (kept >= limit) {
			notes.push(`[grep: showing first ${limit} matches; increase limit to see more.]`);
			break;
		}
	}
	if (skipped) notes.push(`[grep: skipped ${skipped} files larger than the remote 512 KiB read limit.]`);
	if (!blocks.length) notes.push("[grep: no matches.]");
	return { text: [...blocks, ...notes].join("\n") };
}
