// Native request lifecycle adapted from Tencent BrowserSkill f9b180b (MIT).
// Only ownership facts are durable: no task engine, polling or automatic retries.
import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { BskRunner } from "./runner.js";
import { parseBskJson } from "./runner.js";

export interface OwnedRequest {
	requestId: string;
	owner: string;
	session?: string;
	browser?: string;
	active: boolean;
	cleanup: boolean;
}
interface RequestStatus {
	state: string;
	session?: { session_id: string; browser_instance_id: string } | null;
	cleanup_error?: string | null;
}
export function abortCheck(signal?: AbortSignal): void {
	if (signal?.aborted)
		throw new DOMException("BrowserSkill call aborted; inspect state before repeating an action", "AbortError");
}

/** bsk accepts only one business command per session. An aborted queued command never dispatches. */
export class BrowserSerial {
	private readonly tails = new Map<string, Promise<unknown>>();
	run<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		const previous = this.tails.get(key) ?? Promise.resolve();
		const task = new Promise<T>((resolve, reject) => {
			let started = false;
			const onAbort = () => {
				if (!started) reject(new DOMException("Queued BrowserSkill call aborted", "AbortError"));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			void previous
				.catch(() => {})
				.then(() => {
					signal?.removeEventListener("abort", onAbort);
					if (signal?.aborted) {
						onAbort();
						return;
					}
					started = true;
					void Promise.resolve().then(work).then(resolve, reject);
				});
		});
		const tail = Promise.allSettled([previous, task]);
		this.tails.set(key, tail);
		void tail.then(() => {
			if (this.tails.get(key) === tail) this.tails.delete(key);
		});
		return task;
	}
}

export class BrowserSessions {
	private loaded = false;
	private readonly records = new Map<string, OwnedRequest>();
	private readonly stopping = new Map<string, Promise<unknown>>();
	readonly serial = new BrowserSerial();
	constructor(
		private readonly directory: string,
		private readonly runner: BskRunner,
	) {}
	load(): void {
		if (this.loaded) return;
		const file = join(this.directory, "requests.json");
		if (existsSync(file)) {
			const rows: unknown = JSON.parse(readFileSync(file, "utf8"));
			if (!Array.isArray(rows)) throw new Error("Invalid BrowserSkill ownership file");
			for (const row of rows) {
				if (
					!row ||
					typeof row.owner !== "string" ||
					!/^\d+:[a-f0-9-]{36}$/.test(row.requestId) ||
					(row.session !== undefined && typeof row.session !== "string") ||
					(row.browser !== undefined && typeof row.browser !== "string")
				)
					throw new Error("Invalid BrowserSkill request ownership record; refusing cleanup");
				if (this.records.has(row.requestId)) throw new Error("Duplicate BrowserSkill request ownership record");
				this.records.set(row.requestId, {
					requestId: row.requestId,
					owner: row.owner,
					...(row.session ? { session: row.session } : {}),
					...(row.browser ? { browser: row.browser } : {}),
					active: false,
					cleanup: true,
				});
			}
		}
		this.loaded = true;
	}
	private save(): void {
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const temporary = join(this.directory, "requests.tmp");
		// No browser IO can precede this synchronous write-ahead ownership boundary.
		const fd = openSync(temporary, "w", 0o600);
		try {
			writeFileSync(fd, JSON.stringify([...this.records.values()]));
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(temporary, join(this.directory, "requests.json"));
		const dir = openSync(this.directory, "r");
		try {
			fsyncSync(dir);
		} finally {
			closeSync(dir);
		}
	}
	list(owner: string): OwnedRequest[] {
		this.load();
		return [...this.records.values()].filter((r) => r.owner === owner).map((r) => ({ ...r }));
	}
	resolve(owner: string, session?: string, requestId?: string, allowCleanup = false): OwnedRequest {
		this.load();
		const candidates = [...this.records.values()].filter(
			(r) =>
				r.owner === owner &&
				(requestId !== undefined ? r.requestId === requestId : session !== undefined ? r.session === session : true),
		);
		if (candidates.length !== 1)
			throw new Error(
				"Specify one session/request owned by this Yonder session; foreign or ambiguous sessions cannot be used",
			);
		const record = candidates[0];
		if (!record) throw new Error("No owned BrowserSkill session");
		if (!allowCleanup && (!record.active || record.cleanup || !record.session))
			throw new Error(`Browser session not active; stop request ${record.requestId} to release it`);
		return record;
	}
	async start(
		owner: string,
		args: { browser?: string; width?: number; height?: number },
		signal: AbortSignal,
	): Promise<OwnedRequest> {
		this.load();
		abortCheck(signal);
		const record: OwnedRequest = {
			requestId: `${Date.now() + 300000}:${randomUUID()}`,
			owner,
			active: false,
			cleanup: false,
		};
		this.records.set(record.requestId, record);
		try {
			this.save();
		} catch (e) {
			this.records.delete(record.requestId);
			throw e;
		}
		try {
			const prepared = await this.request(record, "prepare", signal);
			if (prepared.state !== "prepared") throw new Error(`Browser request not prepared: ${JSON.stringify(prepared)}`);
			abortCheck(signal);
			if (record.cleanup || !this.records.has(record.requestId))
				throw new Error("Browser start cancelled during cleanup");
			const argv = ["session", "start", "--request-id", record.requestId, "--no-focus"];
			if (args.browser !== undefined) argv.push(`--browser=${args.browser}`);
			if (args.width !== undefined && args.height !== undefined)
				argv.push("--width", String(args.width), "--height", String(args.height));
			const result = await this.runner.run(argv, { signal, tag: record.requestId, timeoutMs: 120000 });
			abortCheck(signal);
			const reply = parseBskJson(result, "session start") as { session_id: string; browser_instance_id: string };
			if (typeof reply.session_id !== "string" || typeof reply.browser_instance_id !== "string")
				throw new Error("Invalid browser start identity; request retained for cleanup");
			record.session = reply.session_id;
			record.browser = reply.browser_instance_id;
			this.save();
			// A concurrent explicit stop or session.close may already have cancelled the start.
			if (record.cleanup || !this.records.has(record.requestId))
				throw new Error("Browser start cancelled during cleanup");
			const claimed = await this.request(record, "claim", signal);
			if (claimed.state !== "active" || record.cleanup || !this.records.has(record.requestId))
				throw new Error(`Browser request not active: ${JSON.stringify(claimed)}`);
			abortCheck(signal);
			record.active = true;
			this.save();
			return { ...record };
		} catch (error) {
			try {
				await this.stop(record);
			} catch (cleanupError) {
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}; cleanup failed for owned request ${record.requestId}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
				);
			}
			throw error;
		}
	}
	private async request(
		record: OwnedRequest,
		action: "prepare" | "claim" | "cancel",
		signal?: AbortSignal,
	): Promise<RequestStatus> {
		const result = await this.runner.run(["session", "request", record.requestId, `--${action}`], {
			...(signal ? { signal } : {}),
			tag: action === "cancel" ? `cleanup:${record.requestId}` : record.requestId,
			timeoutMs: 45000,
		});
		abortCheck(signal);
		return parseBskJson(result, `session request ${action}`) as RequestStatus;
	}
	stop(record: OwnedRequest): Promise<unknown> {
		const current = this.stopping.get(record.requestId);
		if (current) return current;
		record.cleanup = true;
		record.active = false;
		try {
			this.save();
		} catch (error) {
			return Promise.reject(error);
		}
		this.runner.killFor(record.requestId);
		const work = this.serial
			.run(record.requestId, async () => {
				const reply = await this.request(record, "cancel");
				if (!["closed", "failed"].includes(reply.state))
					throw new Error(`Browser cleanup incomplete: ${JSON.stringify(reply)}`);
				if (
					reply.session &&
					record.session &&
					(reply.session.session_id !== record.session || reply.session.browser_instance_id !== record.browser)
				)
					throw new Error("Browser cleanup identity mismatch; ownership retained");
				this.records.delete(record.requestId);
				try {
					this.save();
				} catch (error) {
					this.records.set(record.requestId, record);
					throw error;
				}
				return reply;
			})
			.finally(() => {
				this.stopping.delete(record.requestId);
			});
		this.stopping.set(record.requestId, work);
		return work;
	}
	async cleanup(owner?: string): Promise<void> {
		this.load();
		const records = [...this.records.values()].filter((r) => owner === undefined || r.owner === owner);
		const results = await Promise.allSettled(records.map((r) => this.stop(r)));
		const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
		if (failures.length) throw new Error(failures.map((r) => String(r.reason)).join("; "));
	}
}

/** Cancel only the waiter, never an already accepted native cleanup. */
export function waitForCleanup<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const onAbort = () =>
			reject(new DOMException("Browser cleanup continues; list the owned request before retrying", "AbortError"));
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
		void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}
