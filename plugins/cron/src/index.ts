import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type Attachment,
	type Capability,
	definePlugin,
	type EventInput,
	type PluginAPI,
	parseRef,
	type ToolContext,
	type TSchema,
} from "@yonder/sdk";
import { Check } from "typebox/value";
import { instant, next, type Schedule, validateSchedule } from "./schedule.js";

type Owner = Pick<ToolContext, "session" | "agent" | "profile">;
type Payload =
	| { kind: "event"; type: string; target: string; data: Record<string, unknown> }
	| { kind: "preset"; preset: string; text: string }
	| { kind: "command"; command: string | string[]; cwd?: string }
	| { kind: "script"; path: string; interpreter: string; args?: string[]; cwd?: string };
interface Job {
	id: string;
	name: string;
	owner: Owner;
	capabilities: Capability[];
	schedule: Schedule;
	payload: Payload;
	delivery?: { to: string; via?: string };
	enabled: boolean;
	missed: "coalesce" | "skip";
	start?: string;
	end?: string;
	maxRuns?: number;
	runs: number;
	next: number | null;
	created: string;
	updated: string;
}
interface RecordRun {
	id: string;
	job: string;
	scheduled: number | null;
	started: string;
	ended?: string;
	status: "running" | "done" | "run-failed" | "delivery-failed" | "schedule-failed" | "interrupted" | "skipped";
	text?: string;
	attachments?: Attachment[];
	error?: string;
	deliveryError?: string;
	event?: string;
	session?: string;
}
const string = { type: "string", minLength: 1 };
const strings = { type: "array", items: string };
const object = (properties: object, required: string[] = []) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});
const command = { anyOf: [string, { ...strings, minItems: 1 }] };
const scheduleSchema = {
	anyOf: [
		object({ kind: { const: "at" }, at: string, timezone: string }, ["kind", "at", "timezone"]),
		object(
			{ kind: { const: "every" }, milliseconds: { type: "integer", minimum: 1000 }, anchor: string, timezone: string },
			["kind", "milliseconds", "anchor", "timezone"],
		),
		object({ kind: { const: "cron" }, expression: string, timezone: string }, ["kind", "expression", "timezone"]),
	],
};
const payloadSchema = {
	anyOf: [
		object({ kind: { const: "event" }, type: string, target: string, data: { type: "object" } }, [
			"kind",
			"type",
			"target",
			"data",
		]),
		object({ kind: { const: "preset" }, preset: string, text: string }, ["kind", "preset", "text"]),
		object({ kind: { const: "command" }, command, cwd: string }, ["kind", "command"]),
		object({ kind: { const: "script" }, path: string, interpreter: string, args: strings, cwd: string }, [
			"kind",
			"path",
			"interpreter",
		]),
	],
};
const jobProperties = {
	name: string,
	schedule: scheduleSchema,
	payload: payloadSchema,
	delivery: { anyOf: [object({ to: string, via: string }, ["to"]), { type: "null" }] },
	enabled: { type: "boolean" },
	missed: { enum: ["coalesce", "skip"] },
	start: { anyOf: [string, { type: "null" }] },
	end: { anyOf: [string, { type: "null" }] },
	maxRuns: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
};
const parameters = object(
	{
		action: { enum: ["create", "get", "list", "update", "enable", "disable", "delete", "run", "history"] },
		id: string,
		job: object(jobProperties),
		limit: { type: "integer", minimum: 1, maximum: 100 },
	},
	["action"],
) as TSchema;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
function sameOwner(job: Job, ctx: ToolContext): boolean {
	return job.owner.agent === null
		? ctx.agent === null && job.owner.session === ctx.session
		: job.owner.agent === ctx.agent && job.owner.profile === ctx.profile;
}

export class Scheduler {
	private jobs: Job[] = [];
	private queue: Promise<unknown> = Promise.resolve();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private stopped = true;
	private running = new Map<
		string,
		{ controller: AbortController; promise: Promise<RecordRun>; session?: string | undefined }
	>();
	constructor(
		private api: PluginAPI,
		private concurrency = 4,
	) {}
	private async atomic(path: string, value: unknown) {
		const temp = `${path}.${randomUUID()}.tmp`;
		await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
		await rename(temp, path);
	}
	private save() {
		return this.atomic(join(this.api.paths.data, "jobs.json"), this.jobs);
	}
	private record(run: RecordRun) {
		return this.atomic(join(this.api.paths.data, "runs", `${run.id}.json`), run);
	}
	private exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const result = this.queue.then(fn);
		this.queue = result.catch(() => {});
		return result;
	}
	async start() {
		await mkdir(join(this.api.paths.data, "runs"), { recursive: true, mode: 0o700 });
		try {
			this.jobs = JSON.parse(await readFile(join(this.api.paths.data, "jobs.json"), "utf8")) as Job[];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		for (const job of this.jobs) this.validate(job);
		for (const file of await readdir(join(this.api.paths.data, "runs"))) {
			if (!file.endsWith(".json")) continue;
			const run = JSON.parse(await readFile(join(this.api.paths.data, "runs", file), "utf8")) as RecordRun;
			if (run.status === "running") {
				run.status = "interrupted";
				run.ended = new Date().toISOString();
				run.error = "Service restarted; unknown side effects are not retried";
				await this.record(run);
				await this.api.events.emit({ type: "cron.interrupted", from: "plugin:cron", data: run });
			}
		}
		this.stopped = false;
		await this.tick(true);
	}
	async stop() {
		this.stopped = true;
		clearTimeout(this.timer);
		await this.queue;
		for (const active of this.running.values()) {
			active.controller.abort();
			if (active.session) await this.api.sessions.abort(active.session);
		}
		await Promise.allSettled([...this.running.values()].map((active) => active.promise));
		await this.queue;
	}
	private validate(job: Job) {
		validateSchedule(job.schedule);
		if (job.start !== undefined) instant(job.start);
		if (job.end !== undefined) instant(job.end);
		if (job.start && job.end && instant(job.start) > instant(job.end)) throw new Error("start must not exceed end");
		if (job.payload.kind === "event") {
			if (!job.capabilities.includes("admin"))
				throw new Error(
					"admin capability required for raw event schedules; use a capability-scoped preset for ordinary tasks",
				);
			if (!job.payload.type.startsWith("cron.") || !/^cron\.[a-zA-Z0-9_.-]+$/.test(job.payload.type))
				throw new Error("Event type must be in cron.* namespace");
			const ref = parseRef(job.payload.target);
			if (ref.kind !== "conv")
				throw new Error("Event target must be an explicit conv reference; Agent wakeup requires configured bindings");
		}
		if (job.delivery) {
			const target = parseRef(job.delivery.to);
			if (target.kind !== "conv" && target.kind !== "acct")
				throw new Error("Delivery target must be explicit channel conv/acct reference");
			if (!job.capabilities.includes("message")) throw new Error("message capability required for channel delivery");
		}
		if (["command", "script"].includes(job.payload.kind) && !job.capabilities.includes("exec"))
			throw new Error("exec capability required");
	}
	private arm() {
		clearTimeout(this.timer);
		if (this.stopped) return;
		const due = this.jobs
			.filter((j) => j.enabled && j.next !== null && !this.running.has(j.id))
			.map((j) => j.next as number);
		// Capacity is reconsidered when an active run completes; no hot loop for queued jobs.
		if (!due.length || this.running.size >= this.concurrency) return;
		const delay = Math.max(1, Math.min(2147483647, Math.min(...due) - Date.now()));
		this.timer = setTimeout(() => {
			void this.tick(false).catch((e) => {
				this.api.log.error("cron scheduling failed", { error: errorText(e) });
			});
		}, delay);
	}
	async tick(restart = false) {
		await this.exclusive(async () => {
			if (this.stopped) return;
			const now = Date.now();
			for (const job of this.jobs) {
				if (!job.enabled || job.next === null || job.next > now || this.running.has(job.id)) continue;
				const scheduled = job.next;
				if ((restart && job.missed === "skip") || (job.end && now > instant(job.end))) {
					job.next = next(job.schedule, now, job.start, job.end);
					const run: RecordRun = {
						id: randomUUID(),
						job: job.id,
						scheduled,
						started: new Date().toISOString(),
						ended: new Date().toISOString(),
						status: "skipped",
						text: "Missed while service was stopped",
					};
					await this.record(run);
					await this.save();
					continue;
				}
				if (this.running.size >= this.concurrency) continue;
				try {
					await this.launch(job, scheduled);
				} catch (error) {
					job.enabled = false;
					const run: RecordRun = {
						id: randomUUID(),
						job: job.id,
						scheduled,
						started: new Date().toISOString(),
						ended: new Date().toISOString(),
						status: "schedule-failed",
						error: errorText(error),
					};
					await this.record(run);
					await this.save();
					await this.api.events.emit({ type: "cron.schedule-failed", from: "plugin:cron", data: run });
				}
			}
			this.arm();
		});
	}
	private async launch(job: Job, scheduled: number | null): Promise<{ completion: Promise<RecordRun> }> {
		if (this.stopped) throw new Error("Cron service stopped");
		if (
			scheduled === null &&
			((job.start && Date.now() < instant(job.start)) || (job.end && Date.now() > instant(job.end)))
		)
			throw new Error("Outside job execution window");
		if (this.running.has(job.id)) throw new Error("Job already running");
		if (this.running.size >= this.concurrency) throw new Error("Cron concurrency limit reached");
		if (job.maxRuns !== undefined && job.runs >= job.maxRuns) throw new Error("Job run count exhausted");
		const run: RecordRun = {
			id: randomUUID(),
			job: job.id,
			scheduled,
			started: new Date().toISOString(),
			status: "running",
		};
		const controller = new AbortController();
		job.runs++;
		if (scheduled !== null) job.next = next(job.schedule, Date.now(), job.start, job.end);
		if (job.maxRuns !== undefined && job.runs >= job.maxRuns) {
			job.enabled = false;
			job.next = null;
		}
		await this.record(run);
		await this.save();
		const active = { controller, promise: Promise.resolve(run), session: undefined as string | undefined };
		this.running.set(job.id, active);
		active.promise = this.execute(job, run, active).finally(() => {
			this.running.delete(job.id);
			this.arm();
		});
		void active.promise.catch((error) =>
			this.api.log.error("cron result persistence failed", { job: job.id, error: errorText(error) }),
		);
		// Do not await execution under the scheduler mutation lock.
		return { completion: active.promise };
	}
	private async execute(
		job: Job,
		run: RecordRun,
		active: { controller: AbortController; session?: string | undefined },
	): Promise<RecordRun> {
		try {
			await this.api.events.emit({
				type: "cron.started",
				from: "plugin:cron",
				data: { job: job.id, run: run.id, scheduled: run.scheduled },
			});
			const authority = await this.api.execution.resolve(job.owner);
			const capabilities = job.capabilities.filter((c) => authority.capabilities.includes(c));
			if (job.delivery && !capabilities.includes("message")) throw new Error("Creator message capability revoked");
			const payload = job.payload;
			if (payload.kind === "event") {
				const event: EventInput = {
					type: payload.type,
					from: "plugin:cron",
					data: { ...payload.data, target: payload.target, cron: { job: job.id, run: run.id } },
				};
				if (payload.target.startsWith("conv:")) event.conv = payload.target;
				const result = await new Promise<Awaited<ReturnType<PluginAPI["events"]["ask"]>>>((resolve, reject) => {
					const abort = () => reject(new Error("Service stopped after event dispatch; Agent run is owned by kernel"));
					active.controller.signal.addEventListener("abort", abort, { once: true });
					if (active.controller.signal.aborted) {
						abort();
						return;
					}
					void this.api.events
						.ask(event)
						.then(resolve, reject)
						.finally(() => active.controller.signal.removeEventListener("abort", abort));
				});
				run.event = result.event.id;
				run.text = result.results.map((r) => r.text).join("\n\n");
				run.attachments = result.results.flatMap((r) => r.attachments ?? []);
				if (result.results.some((r) => r.status !== "done"))
					throw new Error(result.results.map((r) => r.reason || r.status).join("; "));
			} else if (payload.kind === "preset") {
				const session = await this.api.sessions.open({
					preset: payload.preset,
					parent: job.owner.session,
					capabilities,
					close: "manual",
				});
				active.session = session.id;
				run.session = session.id;
				try {
					if (active.controller.signal.aborted) throw new Error("Cron stopped");
					const result = await this.api.sessions.submit(session.id, { text: payload.text }, { wait: true });
					run.text = result.text;
					if (result.attachments) run.attachments = result.attachments;
					if (result.status !== "done") throw new Error(result.reason || result.status);
				} finally {
					await this.api.sessions.close(session.id);
				}
			} else {
				const command =
					payload.kind === "command" ? payload.command : [payload.interpreter, payload.path, ...(payload.args ?? [])];
				const result = await this.api.execution.run({
					owner: job.owner,
					capabilities,
					command,
					...(payload.cwd === undefined ? {} : { cwd: payload.cwd }),
					signal: active.controller.signal,
				});
				run.text = `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`;
				if (result.exitCode !== 0) throw new Error(`Command exited ${result.exitCode}`);
			}
			run.status = "done";
		} catch (error) {
			run.status = active.controller.signal.aborted ? "interrupted" : "run-failed";
			run.error = errorText(error);
		}
		if (job.delivery && !active.controller.signal.aborted) {
			try {
				const authority = await this.api.execution.resolve(job.owner);
				if (!job.capabilities.includes("message") || !authority.capabilities.includes("message"))
					throw new Error("Creator message capability revoked");
				const text = run.error ? `Cron ${job.name} failed: ${run.error}\n${run.text ?? ""}` : (run.text ?? "");
				const delivery = await this.api.messages.send({
					...job.delivery,
					text,
					...(run.attachments ? { attachments: run.attachments } : {}),
					signal: active.controller.signal,
				});
				if (!delivery.ok) throw new Error(delivery.error || "Delivery failed");
			} catch (error) {
				run.deliveryError = errorText(error);
				run.status = "delivery-failed";
			}
		}
		run.ended = new Date().toISOString();
		await this.record(run);
		await this.api.events.emit({ type: `cron.${run.status}`, from: "plugin:cron", data: run });
		return run;
	}
	async manage(args: unknown, ctx: ToolContext, exec: boolean) {
		if (!Check(parameters, args)) throw new Error("Invalid cron arguments");
		const a = args as { action: string; id?: string; job?: Partial<Job>; limit?: number };
		if (a.action === "list") return this.jobs.filter((j) => sameOwner(j, ctx));
		const job = this.jobs.find((j) => j.id === a.id && sameOwner(j, ctx));
		if (a.action !== "create" && !job) throw new Error("Job not found for caller");
		if (a.action === "get") return job;
		if (a.action === "history") {
			const history: RecordRun[] = [];
			for (const file of await readdir(join(this.api.paths.data, "runs"))) {
				if (!file.endsWith(".json")) continue;
				const run = JSON.parse(await readFile(join(this.api.paths.data, "runs", file), "utf8")) as RecordRun;
				if (run.job === job?.id) {
					history.push(run);
					history.sort((x, y) => y.started.localeCompare(x.started));
					if (history.length > (a.limit ?? 20)) history.pop();
				}
			}
			return history;
		}
		if (a.action === "run") {
			if (["command", "script"].includes((job as Job).payload.kind) && (!exec || !ctx.capabilities.includes("exec")))
				throw new Error("Use cron_exec with exec capability for command/script jobs");
			let result: Promise<RecordRun> | undefined;
			await this.exclusive(async () => {
				if (!this.jobs.includes(job as Job)) throw new Error("Job changed; read current job before running");
				result = (await this.launch(job as Job, null)).completion;
			});
			return result;
		}
		return this.exclusive(async () => {
			if (job && !this.jobs.includes(job)) throw new Error("Job changed; read current job before updating");
			if (job && this.running.has(job.id) && a.action !== "disable")
				throw new Error("Cannot modify or delete a running job");
			if (a.action === "delete") {
				this.jobs = this.jobs.filter((j) => j !== job);
				await this.save();
				this.arm();
				return { deleted: a.id };
			}
			if (a.action === "disable" || a.action === "enable") {
				(job as Job).enabled = a.action === "enable";
				if (a.action === "enable") (job as Job).next = next((job as Job).schedule, Date.now(), job?.start, job?.end);
				await this.save();
				this.arm();
				return job;
			}
			if (!a.job) throw new Error("job required");
			if (a.action === "create" && (!a.job.name || !a.job.schedule || !a.job.payload))
				throw new Error("name, schedule, payload required");
			const now = new Date().toISOString();
			const updated: Job = {
				id: randomUUID(),
				owner: { session: ctx.session, agent: ctx.agent, profile: ctx.profile },
				capabilities: [...ctx.capabilities],
				name: "",
				schedule: a.job.schedule as Schedule,
				payload: a.job.payload as Payload,
				runs: 0,
				enabled: true,
				missed: "coalesce",
				created: now,
				updated: now,
				next: null,
				...job,
				...a.job,
			};
			for (const key of ["delivery", "start", "end", "maxRuns"] as const)
				if (updated[key] === null) delete updated[key];
			if (["command", "script"].includes(updated.payload.kind) && (!exec || !ctx.capabilities.includes("exec")))
				throw new Error("Use cron_exec with exec capability for command/script jobs");
			if (updated.delivery && !ctx.capabilities.includes("message")) throw new Error("message capability required");
			// Updates cannot preserve old privileges after the caller loses them.
			updated.capabilities = updated.capabilities.filter((c) => ctx.capabilities.includes(c));
			this.validate(updated);
			updated.updated = now;
			updated.next = next(updated.schedule, Date.now() - 1, updated.start, updated.end);
			if (updated.maxRuns !== undefined && updated.runs >= updated.maxRuns) updated.enabled = false;
			this.jobs = [...this.jobs.filter((j) => j.id !== updated.id), updated];
			await this.save();
			this.arm();
			return updated;
		});
	}
}

export default definePlugin({
	async setup(api) {
		const config = api.config as { concurrency?: number } | undefined;
		const concurrency = config?.concurrency ?? 4;
		if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64)
			throw new Error("cron concurrency must be integer 1..64");
		const scheduler = new Scheduler(api, concurrency);
		api.triggers.register({ id: "cron", start: () => scheduler.start(), stop: () => scheduler.stop() });
		for (const exec of [false, true])
			api.tools.register({
				name: exec ? "cron_exec" : "cron_manage",
				description: exec
					? "Manage owned scheduled jobs including no-model command/script jobs. Prefer these for deterministic checks/forwarding instead of waking a model. Check existing jobs before creating, use explicit timezone/targets, retain the returned id and update or stop it when the purpose changes. Inspect history to distinguish scheduling, execution and delivery failure before retrying; unknown side effects must not be replayed. The local host must be awake and running."
					: "Manage owned cron event/preset jobs; CRUD, enable/disable, run and history. A note is not a schedule: verify the saved job and retain its id. Check for an existing matching job, use explicit timezone/targets and stop obsolete jobs. Keep unchanged checks quiet unless periodic updates were requested. Diagnose the actual history stage before retrying; a saved job is not a successful run or delivered message. The local host must be awake and running.",
				parameters,
				capabilities: exec ? ["write", "exec"] : ["write"],
				async execute(args, ctx) {
					try {
						return { text: JSON.stringify(await scheduler.manage(args, ctx, exec), null, 2) };
					} catch (error) {
						return { text: errorText(error), isError: true };
					}
				},
			});
	},
});
