import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { Check } from "typebox/value";
import { executeRun } from "./execute.js";
import {
	checkDelivery,
	errorText,
	type Job,
	type Payload,
	parameters,
	type RecordRun,
	sameOwner,
	validateJob,
} from "./job.js";
import { loadJobs, loadRuns, recordRun, saveJobs } from "./persistence.js";
import { instant, next, type Schedule } from "./schedule.js";

export type { Job, RecordRun } from "./job.js";

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
	private save() {
		return saveJobs(this.api, this.jobs);
	}
	private record(run: RecordRun) {
		return recordRun(this.api, run);
	}
	private exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const result = this.queue.then(fn);
		this.queue = result.catch(() => {});
		return result;
	}
	async start() {
		await mkdir(join(this.api.paths.data, "runs"), { recursive: true, mode: 0o700 });
		this.jobs = await loadJobs(this.api);
		for (const job of this.jobs) this.validate(job);
		for (const run of await loadRuns(this.api)) {
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
		validateJob(job);
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
		active.promise = executeRun(this.api, job, run, active).finally(() => {
			this.running.delete(job.id);
			this.arm();
		});
		void active.promise.catch((error) =>
			this.api.log.error("cron result persistence failed", { job: job.id, error: errorText(error) }),
		);
		// Do not await execution under the scheduler mutation lock.
		return { completion: active.promise };
	}
	async manage(args: unknown, ctx: ToolContext | undefined, exec: boolean, hostOwner?: Job["owner"]) {
		if (!Check(parameters, args)) throw new Error("Invalid cron arguments");
		const a = args as { action: string; id?: string; job?: Partial<Job>; limit?: number };
		const accessible = (job: Job) => !ctx || sameOwner(job, ctx) || ctx.capabilities.includes("admin");
		if (a.action === "list") return this.jobs.filter(accessible);
		const job = this.jobs.find((j) => j.id === a.id && accessible(j));
		if (a.action !== "create" && !job) throw new Error("Job not found for caller");
		if (a.action === "get") return job;
		if (a.action === "history") {
			const history: RecordRun[] = [];
			for (const run of await loadRuns(this.api)) {
				if (run.job === job?.id) {
					history.push(run);
					history.sort((x, y) => y.started.localeCompare(x.started));
					if (history.length > (a.limit ?? 20)) history.pop();
				}
			}
			return history;
		}
		if (a.action === "run") {
			if (
				["command", "script"].includes((job as Job).payload.kind) &&
				(!exec || (ctx && !ctx.capabilities.includes("exec")))
			)
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
			if (!job && !ctx && !hostOwner) throw new Error("Creating a job requires an execution owner");
			if (a.action === "create" && (!a.job.name || !a.job.schedule || !a.job.payload))
				throw new Error("name, schedule, payload required");
			const now = new Date().toISOString();
			const authority = !job && !ctx && hostOwner ? await this.api.execution.resolve(hostOwner) : undefined;
			const updated: Job = {
				id: randomUUID(),
				owner: job?.owner ?? hostOwner ?? { session: ctx!.session, agent: ctx!.agent, profile: ctx!.profile },
				capabilities: job?.capabilities ?? authority?.capabilities ?? [...ctx!.capabilities],
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
			if (
				["command", "script"].includes(updated.payload.kind) &&
				(!exec || (ctx && !ctx.capabilities.includes("exec")))
			)
				throw new Error("Use cron_exec with exec capability for command/script jobs");
			if (updated.delivery && ctx && !ctx.capabilities.includes("message"))
				throw new Error("message capability required");
			// Other owners' jobs keep their original ceiling; execution rechecks their current authority.
			if (ctx && (!job || sameOwner(job, ctx)))
				updated.capabilities = updated.capabilities.filter((c) => ctx.capabilities.includes(c));
			this.validate(updated);
			if (updated.delivery) {
				if (ctx) checkDelivery(updated.delivery, ctx);
				const authority = await this.api.execution.resolve(updated.owner);
				if (!authority.capabilities.includes("message")) throw new Error("Creator message capability revoked");
				checkDelivery(updated.delivery, authority);
			}
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
