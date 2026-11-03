import { lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/** Read-only view of pi session files (~/.pi/agent/sessions/**\/*.jsonl). Unknown entry types are kept, never rejected. */

export const defaultPiSessionsDir = () => join(homedir(), ".pi", "agent", "sessions");

export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}
export type ImportItem = { id: string; ts?: string } & (
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string; model?: string | undefined; stopReason?: string | undefined }
	| { kind: "thinking"; text: string }
	| { kind: "tool_call"; callId: string; name: string; args: unknown }
	| { kind: "tool_result"; callId: string; name?: string; text: string; isError?: boolean }
	| { kind: "compaction"; summary: string; tokensBefore?: number }
	| { kind: "system"; text: string }
	| { kind: "event"; event: string; text?: string | undefined; data?: unknown }
	| { kind: "unknown"; type: string; raw: unknown }
);
export interface ImportTodoItem {
	id: string;
	text: string;
	state: "todo" | "doing" | "done" | "cancelled";
	order: number;
	description?: string | undefined;
	activeForm?: string | undefined;
	blockedBy?: string[] | undefined;
}
export interface ImportTodo {
	items: ImportTodoItem[];
	done: number;
	total: number;
	/** The tool result entry the snapshot was taken from. */
	source: { entry: string; ts?: string };
}
export interface ImportUsage {
	totals: UsageTotals;
	assistantMessages: number;
	byModel: Record<string, UsageTotals & { messages: number }>;
}
export interface ImportSummary {
	id: string;
	sessionId?: string;
	cwd?: string;
	started?: string;
	modified: string;
	bytes: number;
	/** True when the file exceeded the read cap and only its leading complete lines were parsed. */
	truncated: boolean;
	messages: number;
	title: string;
	model?: string;
}
export interface ImportShow {
	summary: ImportSummary;
	total: number;
	offset: number;
	hasMore: boolean;
	items: ImportItem[];
	todo: ImportTodo | null;
	usage: ImportUsage;
	/** Lines that could not be parsed or carried an unrecognised shape. */
	issues: Array<{ line: number; message: string }>;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const emptyUsage = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });

function blocksText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!isObject(block)) return "";
			if (block.type === "text") return str(block.text) ?? "";
			if (block.type === "image") return "[image]";
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

const todoStates: Record<string, ImportTodoItem["state"]> = {
	pending: "todo",
	in_progress: "doing",
	completed: "done",
	deleted: "cancelled",
};
function todoFrom(details: unknown, source: ImportTodo["source"]): ImportTodo | undefined {
	if (!isObject(details) || !Array.isArray(details.tasks)) return undefined;
	const items = details.tasks.flatMap((task, order): ImportTodoItem[] => {
		if (!isObject(task) || (typeof task.id !== "number" && typeof task.id !== "string")) return [];
		const state = todoStates[String(task.status)] ?? "todo";
		return [
			{
				id: String(task.id),
				text: str(task.subject) ?? str(task.text) ?? "",
				state,
				order,
				...(str(task.description) ? { description: str(task.description) } : {}),
				...(str(task.activeForm) ? { activeForm: str(task.activeForm) } : {}),
				...(Array.isArray(task.blockedBy) && task.blockedBy.length ? { blockedBy: task.blockedBy.map(String) } : {}),
			},
		];
	});
	const live = items.filter((item) => item.state !== "cancelled");
	return { items, done: live.filter((item) => item.state === "done").length, total: live.length, source };
}

/** Pure parser: one file's text to transcript items, todo snapshot and usage. */
export function parsePiSession(text: string) {
	const items: ImportItem[] = [];
	const issues: ImportShow["issues"] = [];
	const usage: ImportUsage = { totals: emptyUsage(), assistantMessages: 0, byModel: {} };
	let todo: ImportTodo | undefined;
	let header: Json | undefined;
	let messages = 0;
	let title = "";
	let model: string | undefined;
	const toolNames = new Map<string, string>();
	const lines = text.split("\n");
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) continue;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch (error) {
			issues.push({ line: index + 1, message: `invalid JSON: ${(error as Error).message}` });
			continue;
		}
		if (!isObject(entry)) {
			issues.push({ line: index + 1, message: "entry is not an object" });
			continue;
		}
		const id = str(entry.id) ?? `line-${index + 1}`;
		const ts = str(entry.timestamp);
		const base = { id, ...(ts ? { ts } : {}) };
		const type = str(entry.type) ?? "";
		if (type === "session") {
			header = entry;
		} else if (type === "message" && isObject(entry.message)) {
			const message = entry.message;
			const role = str(message.role);
			if (role === "user") {
				const body = blocksText(message.content);
				messages++;
				if (!title && body.trim()) title = body.trim().replace(/\s+/g, " ").slice(0, 120);
				items.push({ ...base, kind: "user", text: body });
			} else if (role === "system") {
				items.push({ ...base, kind: "system", text: blocksText(message.content) });
			} else if (role === "assistant") {
				messages++;
				const blocks = Array.isArray(message.content) ? message.content : [];
				const modelName = [str(message.provider), str(message.model)].filter(Boolean).join("/") || undefined;
				model = modelName ?? model;
				const parts = typeof message.content === "string" ? [{ type: "text", text: message.content }] : blocks;
				for (const [at, block] of parts.entries()) {
					const blockId = `${id}:${at}`;
					if (!isObject(block)) continue;
					if (block.type === "text")
						items.push({
							id: blockId,
							...(ts ? { ts } : {}),
							kind: "assistant",
							text: str(block.text) ?? "",
							...(modelName ? { model: modelName } : {}),
							...(str(message.stopReason) ? { stopReason: str(message.stopReason) } : {}),
						});
					else if (block.type === "thinking")
						items.push({ id: blockId, ...(ts ? { ts } : {}), kind: "thinking", text: str(block.thinking) ?? "" });
					else if (block.type === "toolCall") {
						const callId = str(block.id) ?? blockId;
						const name = str(block.name) ?? "";
						toolNames.set(callId, name);
						items.push({
							id: blockId,
							...(ts ? { ts } : {}),
							kind: "tool_call",
							callId,
							name,
							args: block.arguments ?? {},
						});
					} else
						items.push({
							id: blockId,
							...(ts ? { ts } : {}),
							kind: "unknown",
							type: `block:${str(block.type)}`,
							raw: block,
						});
				}
				const used = isObject(message.usage) ? message.usage : undefined;
				if (used) {
					const cost = isObject(used.cost) ? num(used.cost.total) : 0;
					const delta = {
						input: num(used.input),
						output: num(used.output),
						cacheRead: num(used.cacheRead),
						cacheWrite: num(used.cacheWrite),
						cost,
					};
					const modelKey = modelName ?? "unknown";
					usage.byModel[modelKey] ??= { ...emptyUsage(), messages: 0 };
					const bucket = usage.byModel[modelKey];
					bucket.messages++;
					usage.assistantMessages++;
					for (const key of Object.keys(delta) as Array<keyof UsageTotals>) {
						usage.totals[key] += delta[key];
						bucket[key] += delta[key];
					}
				}
			} else if (role === "toolResult") {
				const callId = str(message.toolCallId) ?? id;
				const name = str(message.toolName) ?? toolNames.get(callId);
				items.push({
					...base,
					kind: "tool_result",
					callId,
					...(name ? { name } : {}),
					text: blocksText(message.content),
					...(message.isError === true ? { isError: true } : {}),
				});
				if (name === "todo") todo = todoFrom(message.details, { entry: id, ...(ts ? { ts } : {}) }) ?? todo;
			} else if (role === "compactionSummary" || role === "branchSummary") {
				items.push({ ...base, kind: "compaction", summary: str(message.summary) ?? blocksText(message.content) });
			} else if (role === "bashExecution") {
				items.push({
					...base,
					kind: "event",
					event: "bash_execution",
					text: [str(message.command), str(message.output)].filter(Boolean).join("\n"),
				});
			} else if (role === "custom") {
				items.push({
					...base,
					kind: "event",
					event: str(message.customType) ?? "custom",
					text: blocksText(message.content),
				});
			} else items.push({ ...base, kind: "unknown", type: `message:${role}`, raw: message });
		} else if (type === "compaction" || type === "branch_summary") {
			items.push({
				...base,
				kind: "compaction",
				summary: str(entry.summary) ?? "",
				...(typeof entry.tokensBefore === "number" ? { tokensBefore: entry.tokensBefore } : {}),
			});
		} else if (type === "model_change") {
			model = [str(entry.provider), str(entry.modelId)].filter(Boolean).join("/") || model;
			items.push({
				...base,
				kind: "event",
				event: type,
				text: model,
				data: { provider: entry.provider, modelId: entry.modelId },
			});
		} else if (type === "thinking_level_change") {
			items.push({ ...base, kind: "event", event: type, text: str(entry.thinkingLevel) });
		} else if (type === "custom_message") {
			items.push({
				...base,
				kind: "event",
				event: str(entry.customType) ?? type,
				text: blocksText(entry.content),
				data: { display: entry.display },
			});
		} else if (type === "custom") {
			items.push({ ...base, kind: "event", event: str(entry.customType) ?? type, data: entry.data });
		} else items.push({ ...base, kind: "unknown", type: type || "(none)", raw: entry });
	}
	const summary = {
		sessionId: str(header?.id),
		cwd: str(header?.cwd),
		started: str(header?.timestamp),
		messages,
		title,
		model,
	};
	return { items, todo: todo ?? null, usage, issues, summary };
}

async function* walk(dir: string): AsyncGenerator<string> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(path);
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
	}
}

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const CACHE_BYTES = 64 * 1024 * 1024;
const MAX_PARALLEL = 2;

const cache = new Map<string, { key: string; bytes: number; parsed: ReturnType<typeof parsePiSession> }>();
let cacheBytes = 0;
let running = 0;
const waiting: Array<() => void> = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
	if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
	running++;
	try {
		return await work();
	} finally {
		running--;
		waiting.shift()?.();
	}
}

const notFound = (path: string) => Object.assign(new Error(`Unknown import: ${path}`), { code: "not_found" });

/** Open by descriptor and compare it with the lstat of the same path, so a file swapped in after the check is refused. */
async function readCapped(path: string) {
	const before = await lstat(path);
	if (!before.isFile()) throw notFound(path);
	const handle = await open(path, "r");
	try {
		const info = await handle.stat();
		if (info.ino !== before.ino || info.dev !== before.dev || !info.isFile()) throw notFound(path);
		const length = Math.min(info.size, MAX_FILE_BYTES);
		const buffer = Buffer.alloc(length);
		let filled = 0;
		while (filled < length) {
			const { bytesRead } = await handle.read(buffer, filled, length - filled, filled);
			if (!bytesRead) break;
			filled += bytesRead;
		}
		const truncated = info.size > MAX_FILE_BYTES;
		let end = filled;
		// Never parse a half line: cut back to the last newline of a truncated read.
		if (truncated) end = buffer.subarray(0, filled).lastIndexOf(0x0a) + 1;
		return { text: buffer.subarray(0, end).toString("utf8"), info, truncated };
	} finally {
		await handle.close();
	}
}

async function load(path: string) {
	return slot(async () => {
		const { text, info, truncated } = await readCapped(path);
		const key = `${info.mtimeMs}:${info.size}`;
		const hit = cache.get(path);
		if (hit?.key === key) return { parsed: hit.parsed, info, truncated };
		const parsed = parsePiSession(text);
		const bytes = text.length;
		if (hit) cacheBytes -= hit.bytes;
		cache.delete(path);
		cache.set(path, { key, bytes, parsed });
		cacheBytes += bytes;
		// Bounded by file count and by total source bytes; oldest entries go first.
		while (cache.size > 64 || cacheBytes > CACHE_BYTES) {
			const oldest = cache.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			cacheBytes -= cache.get(oldest)?.bytes ?? 0;
			cache.delete(oldest);
		}
		return { parsed, info, truncated };
	});
}
function summaryOf(
	root: string,
	path: string,
	parsed: ReturnType<typeof parsePiSession>,
	info: { size: number; mtime: Date },
	truncated: boolean,
): ImportSummary {
	const { sessionId, cwd, started, messages, title, model } = parsed.summary;
	return {
		id: relative(root, path).split(sep).join("/"),
		...(sessionId ? { sessionId } : {}),
		...(cwd ? { cwd } : {}),
		...(started ? { started } : {}),
		modified: info.mtime.toISOString(),
		bytes: info.size,
		truncated,
		messages,
		title,
		...(model ? { model } : {}),
	};
}

export async function listPiSessions(dir: string, options: { cwd?: string; limit?: number } = {}) {
	const root = resolve(dir);
	const rows: ImportSummary[] = [];
	for await (const path of walk(root)) {
		let loaded: Awaited<ReturnType<typeof load>>;
		try {
			loaded = await load(path);
		} catch (error) {
			// A file that vanished or was swapped for a link while listing is skipped, not fatal.
			if ((error as { code?: string }).code === "not_found" || (error as NodeJS.ErrnoException).code === "ENOENT")
				continue;
			throw error;
		}
		const row = summaryOf(root, path, loaded.parsed, loaded.info, loaded.truncated);
		if (options.cwd === undefined || row.cwd === options.cwd) rows.push(row);
	}
	rows.sort((a, b) => b.modified.localeCompare(a.modified));
	return { dir: root, total: rows.length, sessions: rows.slice(0, options.limit ?? 200) };
}

export async function showPiSession(
	dir: string,
	id: string,
	options: { offset?: number; limit?: number } = {},
): Promise<ImportShow> {
	const root = await realpath(resolve(dir));
	let path: string;
	try {
		path = await realpath(resolve(root, id));
	} catch {
		throw Object.assign(new Error(`Unknown import: ${id}`), { code: "not_found" });
	}
	if (!path.startsWith(root + sep) || !path.endsWith(".jsonl"))
		throw Object.assign(new Error(`Unknown import: ${id}`), { code: "not_found" });
	const { parsed, info, truncated } = await load(path);
	const offset = options.offset ?? 0;
	const limit = options.limit ?? 500;
	return {
		summary: summaryOf(root, path, parsed, info, truncated),
		total: parsed.items.length,
		offset,
		hasMore: offset + limit < parsed.items.length,
		items: parsed.items.slice(offset, offset + limit),
		todo: parsed.todo,
		usage: parsed.usage,
		issues: parsed.issues,
	};
}
