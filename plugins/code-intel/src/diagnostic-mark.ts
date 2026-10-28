import { createHash } from "node:crypto";
import { executionContext, type Tool, type ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import { callLens } from "./lens-mcp.js";

type Mark = {
	filePath: string;
	line: number;
	message: string;
	disposition: "false-positive" | "suppress" | "defer" | "flagged";
	rule?: string;
	tool?: string;
	reason?: string;
};
type Finding = { line: number; severity: string; semantic?: string; tool?: string; rule?: string; message: string };
const deferred = new Map<string, Set<string>>();
const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
function findings(text: string): Finding[] {
	const match = /```json\n([\s\S]*?)\n```/.exec(text);
	if (!match?.[1])
		throw new Error("pi-lens did not return complete structured diagnostics; retry with a smaller file.");
	const parsed = JSON.parse(match[1]) as { diagnostics?: Finding[] };
	if (!Array.isArray(parsed.diagnostics)) throw new Error("pi-lens did not return diagnostics.");
	return parsed.diagnostics;
}
function hashLine(line: string) {
	let h = 2166136261;
	for (const c of line.replace(/\s+/g, "")) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return (h >>> 0).toString(16).padStart(8, "0");
}
function anchor(
	file: string,
	mark: { tool?: string | undefined; rule?: string | undefined; message: string },
	line?: string,
) {
	const parts = [file, mark.tool ?? "", mark.rule ?? "", normalize(mark.message)];
	if (line !== undefined) parts.push(hashLine(line));
	return `${line === undefined ? "ddw:" : "dd:"}${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12)}`;
}
async function pathOf(ctx: ToolContext, path: string) {
	const r = await ctx.env.absolutePath(path, executionContext(ctx.signal));
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
}
async function read(ctx: ToolContext, path: string) {
	const r = await ctx.env.readTextFile(path, executionContext(ctx.signal));
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
}
async function probe(ctx: ToolContext, path: string) {
	return callLens(
		"pilens_analyze",
		{ file: path, flags: { "no-autoformat": true, "no-autofix": true, "no-tests": true } },
		ctx,
	);
}

// pi-lens uses this legacy pid lock as well as its generation lock. Take it exclusively
// inside the execution environment so concurrent Yonder and pi-lens writers merge safely.
const commitScript = `
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const [path, key, raw] = process.argv.slice(1), lock = path + '.lock';
const token = process.pid + ':' + Date.now() + ':' + randomUUID();
const deadline = Date.now() + 2000;
let fd;
for (;;) {
 try { fd = fs.openSync(lock, 'wx'); fs.writeFileSync(fd, token); break; }
 catch (e) { if (e.code !== 'EEXIST' || Date.now() >= deadline) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
}
try {
 const state = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
 state.dispositions ||= {};
 const old = state.dispositions[key];
 const entry = JSON.parse(raw);
 entry.createdAt = old?.createdAt ?? entry.createdAt;
 state.dispositions[key] = entry;
 const tmp = path + '.' + randomUUID() + '.tmp';
 try { fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, path); }
 finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
 process.stdout.write(JSON.stringify({previousDisposition: old?.disposition}));
} finally { fs.closeSync(fd); if (fs.readFileSync(lock, 'utf8') === token) fs.unlinkSync(lock); }
`;
async function commit(ctx: ToolContext, path: string, key: string, entry: object) {
	let stdout = "",
		stderr = "";
	const result = await ctx.env.exec(
		["node", "-e", commitScript, path, key, JSON.stringify(entry)],
		{
			cwd: ctx.env.cwd,
			timeout: 10,
			onOutput(chunk, _context, info) {
				if (info.stream === "stdout") stdout += chunk;
				else stderr += chunk;
			},
		},
		executionContext(ctx.signal),
	);
	if (!result.ok) throw new Error(result.error.message);
	if (result.value.exitCode !== 0) throw new Error(`Cannot commit diagnostic disposition: ${stderr.slice(-1000)}`);
	return JSON.parse(stdout) as { previousDisposition?: string };
}
const properties = {
	filePath: Type.String({ minLength: 1 }),
	line: Type.Integer({ minimum: 1 }),
	message: Type.String({ minLength: 1 }),
	disposition: Type.Union([
		Type.Literal("false-positive"),
		Type.Literal("suppress"),
		Type.Literal("defer"),
		Type.Literal("flagged"),
	]),
	rule: Type.Optional(Type.String({ minLength: 1 })),
	tool: Type.Optional(Type.String({ minLength: 1 })),
	reason: Type.Optional(Type.String()),
};
// Adapted from pi-lens 4.4.6 diagnostic dispositions and suppress writer (MIT; see NOTICE).
export const diagnosticMark: Tool = {
	name: "code-intel_lens_diagnostic_mark",
	description:
		"Mark a diagnostic false-positive, suppress, defer for this session, or flag to fix. Suppress writes an inline ignore.",
	parameters: Type.Object(properties, { additionalProperties: false }),
	capabilities: ["read", "write", "exec"],
	async execute(value, ctx) {
		const mark = value as Mark;
		if (mark.disposition === "suppress" && (!mark.rule || /[\r\n,]/.test(mark.rule)))
			throw new Error("suppress requires a single-line rule id");
		const file = await pathOf(ctx, mark.filePath);
		const root = await pathOf(ctx, ".");
		const relative = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
		const original = await read(ctx, file);
		const result = await probe(ctx, file);
		if (result.isError) return result;
		const candidates = findings(result.text).filter(
			(d) =>
				normalize(d.message) === normalize(mark.message) &&
				(!mark.rule || mark.rule === d.rule) &&
				(!mark.tool || mark.tool === d.tool),
		);
		candidates.sort((a, b) => Math.abs(a.line - mark.line) - Math.abs(b.line - mark.line));
		const [actual, second] = candidates;
		if (!actual)
			throw new Error("Diagnostic not found in the current pi-lens result; re-run diagnostics before marking.");
		if (second && Math.abs(actual.line - mark.line) === Math.abs(second.line - mark.line))
			throw new Error("Diagnostic position is ambiguous; re-run diagnostics and use its current line.");
		const content = await read(ctx, file);
		if (content !== original) throw new Error("File changed during diagnosis; retry the mark.");
		const lines = content.split(/\r?\n/);
		const target = lines[actual.line - 1];
		if (!target?.trim()) throw new Error("Diagnostic line is unavailable or blank; refusing to mark.");
		const key = anchor(relative, mark, mark.disposition === "false-positive" ? target : undefined);
		const op = executionContext(ctx.signal);
		const dir = `${root}/.pi-lens/cache`;
		const made = await ctx.env.createDir(dir, { recursive: true }, op);
		if (!made.ok) throw new Error(made.error.message);
		const statePath = `${dir}/diagnostic-dispositions.json`;
		const exists = await ctx.env.exists(statePath, op);
		if (!exists.ok) throw new Error(exists.error.message);
		const state = exists.value
			? (JSON.parse(await read(ctx, statePath)) as { dispositions?: Record<string, Record<string, unknown>> })
			: {};
		const previous = state.dispositions?.[key];
		let previousDisposition = previous?.disposition;
		if (mark.disposition === "suppress") {
			const prefix = /\.(py|rb|sh|bash|zsh|ya?ml|toml|r|pl|pm|ex|exs|elixir|dockerfile|gitignore|conf|cfg|ini)$/i.test(
				file,
			)
				? "#"
				: "//";
			const before = lines[actual.line - 2];
			const match = before?.match(/^([\t ]*(?:\/\/|#)\s*pi-lens-ignore:\s*)([^\n]+)$/);
			if (match) {
				const payload = match[2] ?? "";
				const reason = /(?:\s+--\s+|\s+—\s+|:\s+).+$/u.exec(payload);
				const rules = payload
					.slice(0, reason?.index ?? payload.length)
					.split(",")
					.map((x) => x.trim())
					.filter(Boolean);
				if (mark.rule && !rules.includes(mark.rule)) rules.push(mark.rule);
				lines[actual.line - 2] = match[1] + rules.join(", ") + (reason?.[0] ?? "");
			} else
				lines.splice(actual.line - 1, 0, `${target.match(/^[\t ]*/)?.[0] ?? ""}${prefix} pi-lens-ignore: ${mark.rule}`);
			const write = await ctx.env.writeFile(file, lines.join(content.includes("\r\n") ? "\r\n" : "\n"), op);
			if (!write.ok) throw new Error(write.error.message);
		}
		if (mark.disposition === "defer") {
			const session = `${ctx.env.id}\0${root}\0${ctx.session}`;
			const marks = deferred.get(session) ?? new Set<string>();
			marks.add(key);
			deferred.set(session, marks);
		} else {
			const now = new Date().toISOString();
			const committed = await commit(ctx, statePath, key, {
				disposition: mark.disposition,
				reason: mark.reason,
				createdAt: now,
				lastSeenAt: now,
				...(mark.disposition === "flagged" ? { line: actual.line, lineText: target.trim() } : {}),
			});
			if (committed.previousDisposition) previousDisposition = committed.previousDisposition;
		}
		const logged = await ctx.env.appendFile(
			`${root}/.pi-lens/dispositions.log`,
			`${JSON.stringify({ ts: new Date().toISOString(), event: "mark", ...mark, filePath: relative, line: actual.line, anchor: key, previousDisposition })}\n`,
			op,
		);
		if (!logged.ok) throw new Error(logged.error.message);
		return {
			text: JSON.stringify({
				filePath: relative,
				line: actual.line,
				disposition: mark.disposition,
				scope: mark.disposition === "defer" ? "session" : "project",
				anchor: key,
			}),
		};
	},
};
export const diagnostics: Tool = {
	name: "code-intel_lens_diagnostics",
	description: "Analyze current diagnostics for one source file with pi-lens.",
	parameters: Type.Object(
		{
			source: Type.Optional(Type.Union([Type.Literal("session"), Type.Literal("lsp")])),
			scope: Type.Optional(Type.Union([Type.Literal("paths"), Type.Literal("workspace")])),
			mode: Type.Optional(Type.Union([Type.Literal("delta"), Type.Literal("all"), Type.Literal("full")])),
			path: Type.Optional(Type.String({ minLength: 1 })),
			paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
			severity: Type.Optional(
				Type.Union([
					Type.Literal("error"),
					Type.Literal("warning"),
					Type.Literal("information"),
					Type.Literal("hint"),
					Type.Literal("all"),
				]),
			),
			waitMs: Type.Optional(Type.Number()),
			serverScope: Type.Optional(Type.Union([Type.Literal("primary"), Type.Literal("all")])),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "exec"],
	async execute(value, ctx) {
		const args = value as {
			source?: "session" | "lsp";
			path?: string;
			paths?: string[];
			mode?: string;
			severity?: "error" | "warning" | "information" | "hint" | "all";
			[key: string]: unknown;
		};
		if (args.source === "session" || (!args.source && !args.path))
			return {
				text: "Session diagnostic cache is unavailable: pi-lens MCP runs in a fresh process. Use source=lsp for a fresh probe.",
				isError: true,
			};
		if (args.source === "lsp" || args.paths?.length)
			return callLens("pilens_diagnostics", { ...args, source: "lsp" }, ctx);
		const result = await probe(ctx, args.path!);
		const file = await pathOf(ctx, args.path!),
			root = await pathOf(ctx, ".");
		const relative = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
		if (result.isError) return result;
		const marks = deferred.get(`${ctx.env.id}\0${root}\0${ctx.session}`);
		const op = executionContext(ctx.signal);
		const statePath = `${root}/.pi-lens/cache/diagnostic-dispositions.json`;
		const exists = await ctx.env.exists(statePath, op);
		if (!exists.ok) throw new Error(exists.error.message);
		const state = exists.value
			? (
					JSON.parse(await read(ctx, statePath)) as {
						dispositions?: Record<string, { disposition: string; reason?: string }>;
					}
				).dispositions
			: undefined;
		const lines = (await read(ctx, file)).split(/\r?\n/);
		const scanned = findings(result.text);
		const severityRanks: Record<string, number> = { error: 1, warning: 2, information: 3, hint: 4, all: 4 };
		const maxRank = severityRanks[args.severity ?? "all"] ?? 4;
		const all = scanned.filter((d) => (severityRanks[d.severity] ?? 4) <= maxRank);
		let hidden = 0;
		const visible = all.flatMap((d) => {
			const variants = [undefined, d.tool].flatMap((tool) =>
				[undefined, d.rule].map((rule) => ({ tool, rule, message: d.message })),
			);
			const weak = variants.map((v) => anchor(relative, v));
			const strict = variants.map((v) => anchor(relative, v, lines[d.line - 1] ?? ""));
			const entry = weak.map((k) => state?.[k]).find((x) => x?.disposition === "flagged");
			const suppressed =
				strict.some((k) => state?.[k]?.disposition === "false-positive") ||
				(d.semantic !== "blocking" && weak.some((k) => marks?.has(k) || state?.[k]?.disposition === "suppress"));
			if (suppressed) {
				hidden++;
				return [];
			}
			return [{ ...d, ...(entry ? { flagged: true, reason: entry.reason } : {}) }];
		});
		if (!hidden && all.length === scanned.length && !visible.some((d) => "flagged" in d)) return result;
		return {
			text: JSON.stringify({
				filePath: relative,
				diagnostics: visible,
				suppressed: hidden,
				note: "Filtered by diagnostic dispositions; backend analysis may be incomplete.",
			}),
		};
	},
};
