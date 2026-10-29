import { existsSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type {
	Harness,
	JsonObject,
	ToolExecutionApi,
	ToolExecutionResult,
	ToolRegistration,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { JobDoc } from "./background-docs.js";
import { cid } from "./docs.js";

const DEFAULT_LOG_BYTES = 50 * 1024;
const MAX_LOG_BYTES = 50 * 1024;
/** The durable job document keeps at most this many characters of output. */
const OUTPUT_WINDOW = 65536;

/** One session-owned background job as the model-facing tools present it. */
type BackgroundJob = {
	id: string;
	name: string;
	started: number;
	detached: boolean;
	status: "running" | "completed" | "failed" | "killed";
	exitCode?: number;
	pid?: number;
	output: string;
	/** Complete log file, when the underlying tool writes one. */
	path?: string;
};

const text = (value: string): ToolExecutionResult => ({ output: [{ type: "text", text: value }] });
const failed = (error: string): ToolExecutionResult => ({ output: [{ type: "text", text: error }], isError: true });

const formatDuration = (ms: number): string => {
	if (ms < 1000) return `${String(ms)}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${String(seconds)}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	if (minutes < 60) return `${String(minutes)}m${remainder > 0 ? `${String(remainder)}s` : ""}`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return `${String(hours)}h${rest > 0 ? `${String(rest)}m` : ""}`;
};

const formatSize = (bytes: number): string =>
	bytes < 1024
		? `${String(bytes)}B`
		: bytes < 1024 * 1024
			? `${(bytes / 1024).toFixed(1)}KB`
			: `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

const truncate = (value: string, max: number): string =>
	value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;

const normalizeMaxBytes = (value: unknown): number => {
	const raw = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LOG_BYTES;
	return Math.max(1, Math.min(MAX_LOG_BYTES, raw));
};

/** A task name from the command's first words, so a missing label never leaves a job unnamed. */
const deriveName = (command: string): string => {
	const normalized = command.trim().replace(/\s+/g, " ");
	if (!normalized) return "Background task";
	const words = normalized.split(" ").slice(0, 5).join(" ");
	return truncate(words, 48);
};

/** bash reports its exit code inside the JSON result body; other tools may report none. */
const exitOf = (result: ToolExecutionResult | undefined): number | undefined => {
	const body = result?.output?.find((part) => part.type === "text");
	if (!body || body.type !== "text") return undefined;
	try {
		const value = JSON.parse(body.text) as { exitCode?: unknown };
		return typeof value.exitCode === "number" ? value.exitCode : undefined;
	} catch {
		return undefined;
	}
};

const jobStatus = (terminal: boolean, outcome: string | undefined, result: ToolExecutionResult | undefined) => {
	if (!terminal) return "running" as const;
	if (outcome === "aborted") return "killed" as const;
	if (outcome === "completed") return result?.isError ? ("failed" as const) : ("completed" as const);
	return "failed" as const;
};

const sessionJobs = async (harness: Harness, home: string | undefined, session: string) => {
	const page = await harness.commit(
		(tx) => tx.scanTasks({ conversationId: cid(session), kind: "yonder.background" }, Number.MAX_SAFE_INTEGER),
		C,
	);
	const jobs: BackgroundJob[] = [];
	for (const row of page.items) {
		const doc = await harness.snapshot(JobDoc, row.conversationId, String(row.id), C);
		const outcome = row.state.status === "terminal" ? row.state.outcome : undefined;
		const result = (outcome && "result" in outcome ? outcome.result : undefined) as ToolExecutionResult | undefined;
		const details = result?.details as { pid?: number; fullOutputPath?: string } | undefined;
		const exitCode = exitOf(result);
		const path =
			details?.fullOutputPath ?? (home ? join(home, ".yonder", "background", `${String(row.id)}.log`) : undefined);
		jobs.push({
			id: String(row.id),
			name: doc?.name || "background",
			started: doc?.started ?? 0,
			detached: !!doc?.detached,
			status: jobStatus(row.state.status === "terminal", outcome?.status, result),
			output: doc?.output ?? "",
			...(exitCode !== undefined ? { exitCode } : {}),
			...(details?.pid ? { pid: details.pid } : {}),
			...(path ? { path } : {}),
		});
	}
	return jobs;
};

/** Resolve a full id or an unambiguous prefix; anything else fails with the candidates. */
const match = (jobs: BackgroundJob[], taskId: string): BackgroundJob => {
	const wanted = taskId.trim();
	const found = wanted ? jobs.filter((job) => job.id.startsWith(wanted)) : [];
	const job = found.length === 1 ? found[0] : undefined;
	if (!job)
		throw new Error(
			found.length === 0
				? `Background task not found in this session: ${wanted || "(empty)"}`
				: `Ambiguous background task id ${wanted}: ${found.map((item) => item.id).join(", ")}`,
		);
	return job;
};

const formatSnapshotList = (jobs: BackgroundJob[], now = Date.now()): string => {
	if (jobs.length === 0) return "No background tasks in this session.";
	return jobs
		.map((job) => {
			const icon =
				job.status === "running" ? "▶" : job.status === "completed" ? "✓" : job.status === "killed" ? "■" : "✗";
			const age = formatDuration(job.started ? Math.max(0, now - job.started) : 0);
			const code = job.exitCode !== undefined ? ` exit=${String(job.exitCode)}` : "";
			const pid = job.pid !== undefined ? ` pid=${String(job.pid)}` : "";
			return `${icon} ${job.id} ${job.status} ${age}${code}${pid} — ${truncate(job.name, 80)}\n    output: ${job.path ?? "unavailable"}`;
		})
		.join("\n");
};

const boundedRead = async (path: string, maxBytes: number, tail: boolean) => {
	const stats = await stat(path);
	const totalBytes = stats.size;
	const bytesToRead = Math.min(totalBytes, maxBytes);
	if (bytesToRead === 0) return { content: "", truncated: false, bytesRead: 0, totalBytes };
	const file = await open(path, "r");
	try {
		const buffer = Buffer.alloc(bytesToRead);
		const position = tail ? Math.max(0, totalBytes - bytesToRead) : 0;
		const { bytesRead } = await file.read(buffer, 0, bytesToRead, position);
		return {
			content: buffer.subarray(0, bytesRead).toString("utf8"),
			truncated: totalBytes > bytesRead,
			bytesRead,
			totalBytes,
		};
	} finally {
		await file.close();
	}
};

/** Bounded log text: the complete log file when the tool writes one, the durable window otherwise. */
const logText = async (job: BackgroundJob, maxBytes: number, tail: boolean) => {
	const path = job.path && existsSync(job.path) ? job.path : undefined;
	if (path) {
		const read = await boundedRead(path, maxBytes, tail);
		const content = read.content.length > 0 ? read.content : "(no output yet)";
		if (!read.truncated) return `${content}\n\n[Full output: ${path}]`;
		const omitted = read.totalBytes - read.bytesRead;
		const notice = `[Showing ${tail ? "tail" : "head"} ${formatSize(read.bytesRead)} of ${formatSize(read.totalBytes)}; ${formatSize(omitted)} omitted. Full output: ${path}]`;
		return tail ? `${notice}\n\n${content}` : `${content}\n\n${notice}`;
	}
	const bytes = Buffer.from(job.output);
	const slice = tail ? bytes.subarray(Math.max(0, bytes.length - maxBytes)) : bytes.subarray(0, maxBytes);
	const content = slice.length > 0 ? slice.toString() : "(no output yet)";
	if (bytes.length <= maxBytes && job.output.length < OUTPUT_WINDOW) return content;
	return `${content}\n\n[Showing ${tail ? "tail" : "head"} ${formatSize(slice.length)} of ${formatSize(bytes.length)}; retained output window only]`;
};

/**
 * The four model-facing background tools. `bash` and `process` stay kernel capabilities; these wrap them in the
 * parameter and semantics vocabulary the model is prompted with.
 */
/** Extra per-job options the background runner accepts beyond the underlying tool's own arguments. */
export type JobRunExtra = { immediate?: boolean; label?: string; notify?: boolean };

/** `bg_run` starts the same native bash job as `bash(background=true)` and yields without waiting. */
export const startBash = (
	run: (
		tool: ToolRegistration,
		args: JsonObject,
		api: ToolExecutionApi,
		context: Context,
		extra?: JobRunExtra,
	) => Promise<ToolExecutionResult>,
	args: { command: string },
	api: ToolExecutionApi,
	context: Context,
	extra: { label?: string; notify?: boolean },
) =>
	run({ name: "bash" } as unknown as ToolRegistration, { ...args, background: true }, api, context, {
		...extra,
		immediate: true,
	});

/** The `process` tool: kernel-level handle management for one session-owned background job. */
export function createProcessTool(
	action: (
		session: string,
		args: { action: string; id: string; offset?: number; text?: string; eof?: boolean },
		context: Context,
	) => Promise<unknown>,
): ToolRegistration {
	return {
		name: "process",
		description:
			"Manage a background tool or command owned by this session: status, log, wait (up to 15 seconds), write stdin, or kill. Write accepts eof=true to end stdin. Logs use absolute character offset/next cursors; truncated means the requested prefix was discarded. The original tool result remains available after completion. Use the returned background id, not an OS pid or Agent id. Completion is delivered automatically; inspect only for a dependent step or a suspected stall, not in a polling loop. Read state and incremental output before claiming progress or retrying. kill stops the owned operation; it does not undo external effects, and write is stdin, not an instruction message to an Agent.",
		parameters: Type.Object(
			{
				action: Type.Union(["status", "log", "wait", "write", "kill"].map((x) => Type.Literal(x))),
				id: Type.String({ pattern: "^[0-9]+$" }),
				offset: Type.Optional(Type.Integer({ minimum: 0 })),
				text: Type.Optional(Type.String()),
				eof: Type.Optional(Type.Boolean()),
			},
			{ additionalProperties: false },
		),
		deferred: true as const,
		async execute(value: unknown, api: ToolExecutionApi, context: Context) {
			const args = value as { action: string; id: string; offset?: number; text?: string; eof?: boolean };
			const result = (await action(String(api.conversationId), args, context)) as
				| ToolExecutionResult
				| Record<string, unknown>;
			return "isError" in result
				? (result as ToolExecutionResult)
				: { output: [{ type: "text", text: JSON.stringify(result) }] };
		},
	};
}

export function createBackgroundTools(options: {
	home?: string;
	harness(): Harness;
	start(
		args: { command: string },
		api: ToolExecutionApi,
		context: Context,
		extra: { label?: string; notify?: boolean },
	): Promise<ToolExecutionResult>;
	abort(id: string): Promise<void>;
}): ToolRegistration[] {
	const jobs = (session: string) => sessionJobs(options.harness(), options.home, session);
	const run: ToolRegistration = {
		name: "bg_run",
		description:
			"Start a named long-running shell command in the background and return immediately with a task ID and output path. By default, completed, failed, or killed terminal state is delivered automatically as <background-task-notification> and starts a follow-up agent turn; do not sleep or poll merely to wait. Output is written to the task log file and model-visible logs are bounded to 50.0KB.",
		parameters: Type.Object(
			{
				command: Type.String({ description: "Shell command to start in the background" }),
				name: Type.Optional(
					Type.String({
						description:
							"Short human-readable task name shown in the background dock. Use 2-6 words, not the raw command.",
					}),
				),
				notify: Type.Optional(
					Type.Boolean({
						description:
							"Whether to deliver the durable terminal notification. Default: true; disable only when deliberately taking over completion monitoring.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		deferred: true as const,
		async execute(value, api, context) {
			const args = value as { command: string; name?: string; notify?: boolean };
			const label = args.name?.trim() ? truncate(args.name.trim(), 80) : deriveName(args.command);
			return options.start({ command: args.command }, api, context, {
				label,
				...(args.notify === false ? { notify: false } : {}),
			});
		},
	};
	const status: ToolRegistration = {
		name: "bg_status",
		description:
			"Inspect one background task or list all running/recent background tasks. This is a point-in-time inspection tool, not a waiting primitive.",
		parameters: Type.Object(
			{
				taskId: Type.Optional(
					Type.String({
						description: "Optional task ID or unambiguous prefix. If omitted, all running/recent tasks are returned.",
					}),
				),
			},
			{ additionalProperties: false },
		),
		deferred: true as const,
		async execute(value, api) {
			const args = value as { taskId?: string };
			const all = await jobs(String(api.conversationId));
			const selected = args.taskId?.trim() ? [match(all, args.taskId)] : all.filter((job) => job.detached);
			return text(formatSnapshotList(selected));
		},
	};
	const logs: ToolRegistration = {
		name: "bg_logs",
		description:
			"Read bounded output from a background task for deliberate inspection; this is not a waiting primitive. Output is capped at 50.0KB for model safety and points to the full output file when truncated.",
		parameters: Type.Object(
			{
				taskId: Type.String({ description: "Task ID or unambiguous prefix" }),
				maxBytes: Type.Optional(
					Type.Number({
						description: `Maximum bytes to return, capped at ${formatSize(MAX_LOG_BYTES)}. Default: ${formatSize(DEFAULT_LOG_BYTES)}.`,
					}),
				),
				tail: Type.Optional(
					Type.Boolean({ description: "Read the tail of the log when true, head when false. Default: true." }),
				),
			},
			{ additionalProperties: false },
		),
		deferred: true as const,
		async execute(value, api) {
			const args = value as { taskId: string; maxBytes?: number; tail?: boolean };
			const job = match(await jobs(String(api.conversationId)), args.taskId);
			return text(await logText(job, normalizeMaxBytes(args.maxBytes), args.tail ?? true));
		},
	};
	const kill: ToolRegistration = {
		name: "bg_kill",
		description: "Stop a running background task by ID. Fails loudly if the task is unknown or already finished.",
		parameters: Type.Object(
			{ taskId: Type.String({ description: "Task ID or unambiguous prefix to stop" }) },
			{ additionalProperties: false },
		),
		deferred: true as const,
		async execute(value, api) {
			const session = String(api.conversationId);
			const args = value as { taskId: string };
			const job = match(await jobs(session), args.taskId);
			if (job.status !== "running")
				return failed(`Background task ${job.name} (${job.id}) already finished (${job.status})`);
			await options.abort(job.id);
			const after = match(await jobs(session), job.id);
			return text(
				`Killed background task ${after.name} (${after.id}). Status: ${after.status}. Output: ${after.path ?? "unavailable"}`,
			);
		},
	};
	return [run, status, logs, kill];
}
