import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import {
	beginTask,
	type Card,
	completeStep,
	emptyState,
	type Interaction,
	readState,
	validateCard,
} from "../web/state.mjs";

// Wire contract only: the companion never imports the task ledger or its store.
export interface ActivitySummary {
	schemaVersion: 1;
	observedAt: number;
	agents: Array<{ agentId: string; blocked: number; review: number; waitingUser: number }>;
}
export type ActivitySummaryResponse = {
	schemaVersion: 1;
	sourceRevision: number;
} & (
	| { availability: "available"; summary: ActivitySummary }
	| { availability: "unpublished" | "unavailable"; summary?: never }
);

function readActivitySummary(input: unknown): ActivitySummary {
	const value = input as ActivitySummary | null;
	if (
		value?.schemaVersion !== 1 ||
		!Number.isFinite(value.observedAt) ||
		value.observedAt < 0 ||
		!Array.isArray(value.agents)
	)
		throw new Error("Invalid activity summary");
	const seen = new Set<string>();
	const agents = value.agents.map((agent) => {
		if (
			!agent ||
			typeof agent.agentId !== "string" ||
			!agent.agentId ||
			seen.has(agent.agentId) ||
			![agent.blocked, agent.review, agent.waitingUser].every((count) => Number.isSafeInteger(count) && count >= 0)
		)
			throw new Error("Invalid activity counts");
		seen.add(agent.agentId);
		return { agentId: agent.agentId, blocked: agent.blocked, review: agent.review, waitingUser: agent.waitingUser };
	});
	// Project only the public fields, never proxy task content or upstream errors.
	return { schemaVersion: 1, observedAt: value.observedAt, agents };
}

type Owner = Pick<ToolContext, "session" | "agent" | "profile">;
type Record = { owner: Owner; interaction: Interaction; cancelled: boolean };

export class CompanionService {
	private records: Record[] = [];
	private server: Server | undefined;
	private tail: Promise<unknown> = Promise.resolve();
	private changes = new Set<() => void>();
	private base = "";
	private stopped = true;
	private boardSource: string | undefined;
	private sourceRevision = 0;
	private sourceAbort = new AbortController();
	private boardRequest: { id?: string; revision: number } | undefined;
	constructor(
		private readonly directory: string,
		private readonly desktop: boolean,
		private readonly locale = "zh-CN",
		private readonly timezone = "Asia/Shanghai",
	) {}
	get url() {
		return this.base;
	}
	private async persist() {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const path = join(this.directory, "interactions.json");
		await writeFile(`${path}.tmp`, JSON.stringify(this.records), { mode: 0o600 });
		await rename(`${path}.tmp`, path);
	}
	private mutate<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.tail.then(fn);
		this.tail = next.catch(() => {});
		return next;
	}
	private changed() {
		for (const notify of this.changes) notify();
	}
	/** Cards still waiting for an answer; feeds `activity.*` questions. */
	pending() {
		return this.records.filter((r) => !r.cancelled && !r.interaction.completed).length;
	}
	private active() {
		return this.records.find((r) => !r.cancelled && !r.interaction.completed);
	}
	private async activitySummary(): Promise<ActivitySummaryResponse> {
		const timeout = AbortSignal.timeout(5000);
		for (;;) {
			const source = this.boardSource;
			const sourceRevision = this.sourceRevision;
			const envelope = { schemaVersion: 1 as const, sourceRevision };
			if (!source) return { ...envelope, availability: "unpublished" };
			try {
				const url = new URL(source);
				url.searchParams.delete("id");
				url.searchParams.set("view", "activity");
				const result = await fetch(url, {
					signal: AbortSignal.any([timeout, this.sourceAbort.signal]),
					redirect: "error",
				});
				if (!result.ok) throw new Error("Activity source unavailable");
				const summary = readActivitySummary(await result.json());
				if (sourceRevision === this.sourceRevision) return { ...envelope, availability: "available", summary };
			} catch {
				if (sourceRevision === this.sourceRevision) return { ...envelope, availability: "unavailable" };
			}
			// A switched source invalidates even a late body. Read the current source,
			// within the same request deadline, rather than returning stale counts.
			if (timeout.aborted && this.boardSource)
				return { schemaVersion: 1, sourceRevision: this.sourceRevision, availability: "unavailable" };
		}
	}
	async start() {
		if (this.sourceAbort.signal.aborted) this.sourceAbort = new AbortController();
		try {
			const stored: unknown = JSON.parse(await readFile(join(this.directory, "interactions.json"), "utf8"));
			if (!Array.isArray(stored)) throw new Error("Invalid interaction store");
			for (const row of stored) {
				if (
					!row?.owner ||
					typeof row.owner.session !== "string" ||
					typeof row.owner.profile !== "string" ||
					!(row.owner.agent === null || typeof row.owner.agent === "string") ||
					typeof row.cancelled !== "boolean"
				)
					throw new Error("Invalid interaction owner");
				// The browser state validator also checks every saved original card and answer.
				readState(JSON.stringify({ ...emptyState(), active: row.interaction }));
			}
			this.records = stored;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const html = (await readFile(new URL("../dist/index.html", import.meta.url), "utf8")).replace(
			"</head>",
			`<script>window.yonderSettings=${JSON.stringify({ locale: this.locale, timezone: this.timezone }).replaceAll("<", "\\u003c")};document.documentElement.lang=window.yonderSettings.locale</script></head>`,
		);
		const secret = randomUUID();
		const server = createServer((request, response) => {
			void (async () => {
				const address = server.address();
				if (!address || typeof address === "string") throw new Error("UI server unavailable");
				const origin = `http://127.0.0.1:${address.port}`;
				if (
					request.headers.host !== `127.0.0.1:${address.port}` ||
					(request.headers.origin && request.headers.origin !== origin) ||
					!request.url?.startsWith(`/${secret}/`)
				) {
					response.writeHead(403).end("Denied");
					return;
				}
				const path = request.url.slice(secret.length + 2);
				response.setHeader("Cache-Control", "no-store");
				response.setHeader("X-Content-Type-Options", "nosniff");
				response.setHeader("Referrer-Policy", "no-referrer");
				if (request.method === "GET" && path === "") {
					response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
					return;
				}
				if (request.method === "POST" && path === "board") {
					if (request.headers["content-type"] !== "application/json") throw new Error("JSON required");
					const input = JSON.parse(await this.body(request));
					const source = new URL(input.source);
					if (
						source.protocol !== "http:" ||
						source.hostname !== "127.0.0.1" ||
						(input.id !== undefined && typeof input.id !== "string")
					)
						throw new Error("Invalid board source");
					if (this.boardSource !== source.href) {
						this.sourceRevision++;
						this.boardSource = source.href;
						this.sourceAbort.abort();
						this.sourceAbort = new AbortController();
					}
					this.boardRequest = { id: input.id, revision: (this.boardRequest?.revision ?? 0) + 1 };
					response
						.writeHead(200, { "Content-Type": "application/json" })
						.end(JSON.stringify({ url: this.base, view: input.id ? "detail" : "board" }));
					return;
				}
				if (request.method === "GET" && path === "activity-summary") {
					const summary = await this.activitySummary();
					response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(summary));
					return;
				}
				if (request.method === "GET" && (path === "board" || path.startsWith("board?"))) {
					if (!this.boardSource) throw new Error("No board published");
					const revision = this.sourceRevision;
					const source = new URL(this.boardSource);
					const id = new URL(request.url, origin).searchParams.get("id");
					if (id) source.searchParams.set("id", id);
					if (new URL(request.url, origin).searchParams.get("view") === "panel" || !id)
						source.searchParams.set("view", "panel");
					const result = await fetch(source, {
						signal: AbortSignal.any([AbortSignal.timeout(5000), this.sourceAbort.signal]),
						redirect: "error",
					});
					const body = await result.text();
					if (revision !== this.sourceRevision) throw new Error("Board source changed");
					response.writeHead(result.status, { "Content-Type": "application/json" }).end(body);
					return;
				}
				if (request.method === "GET" && path === "state") {
					response.writeHead(200, { "Content-Type": "application/json" }).end(
						JSON.stringify({
							active: this.active()?.interaction ?? null,
							board: this.boardRequest ? { ...this.boardRequest, sourceRevision: this.sourceRevision } : null,
							history: this.records.filter((r) => r.interaction.completed || r.cancelled).map((r) => r.interaction),
						}),
					);
					return;
				}
				if (request.method === "POST" && path === "answer") {
					if (request.headers["content-type"] !== "application/json") {
						response.writeHead(415).end("JSON required");
						return;
					}
					const input = await this.body(request);
					const answer = JSON.parse(input) as { id?: unknown; answer?: unknown; step?: unknown };
					if (typeof answer.id !== "string" || typeof answer.answer !== "string" || !Number.isInteger(answer.step))
						throw new Error("Invalid answer");
					await this.answer(answer.id, answer.answer, answer.step as number);
					response.writeHead(200, { "Content-Type": "application/json" }).end("{}");
					return;
				}
				response.writeHead(404).end();
			})().catch((error) => {
				if (!response.headersSent) response.writeHead(400).end(error instanceof Error ? error.message : String(error));
				else response.destroy();
			});
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		this.server = server;
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("UI listener unavailable");
		this.base = `http://127.0.0.1:${address.port}/${secret}/`;
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		await writeFile(join(this.directory, "renderer.json"), JSON.stringify({ url: this.base, pid: process.pid }), {
			mode: 0o600,
		});
		if (this.desktop) {
			try {
				await mkdir(this.directory, { recursive: true, mode: 0o700 });
				const path = join(this.directory, "desktop.json");
				await writeFile(`${path}.tmp`, JSON.stringify({ url: this.base, pid: process.pid }), { mode: 0o600 });
				await rename(`${path}.tmp`, path);
			} catch (error) {
				await this.stop();
				throw error;
			}
		}
		this.stopped = false;
	}
	private async body(request: IncomingMessage) {
		const chunks: Buffer[] = [];
		let size = 0;
		for await (const chunk of request) {
			size += chunk.length;
			if (size > 32768) throw new Error("Answer too large");
			chunks.push(chunk);
		}
		return Buffer.concat(chunks).toString("utf8");
	}
	async present(card: unknown, owner: Owner) {
		const validated: Card = validateCard(card);
		if (this.stopped) throw new Error("UI plugin is not running");
		return this.mutate(async () => {
			if (this.stopped) throw new Error("UI plugin stopped");
			const interaction = beginTask(emptyState(), validated, randomUUID()).active as Interaction;
			const record = {
				owner: { session: owner.session, agent: owner.agent, profile: owner.profile },
				interaction,
				cancelled: false,
			};
			this.records.push(record);
			try {
				await this.persist();
			} catch (error) {
				this.records.pop();
				throw error;
			}
			this.changed();
			return {
				id: interaction.id,
				url: this.base,
				inlineUrl: `${this.base}#inline`,
				noticeUrl: `${this.base}#notice`,
				status: "pending",
			};
		});
	}
	async answer(id: string, answer: string, step: number) {
		return this.mutate(async () => {
			const record = this.active();
			if (!record || record.interaction.id !== id || record.interaction.steps.length !== step)
				throw new Error("Interaction is no longer current");
			const previous = record.interaction;
			record.interaction = completeStep({ ...emptyState(), active: previous }, answer, Date.now())
				.active as Interaction;
			try {
				await this.persist();
			} catch (error) {
				record.interaction = previous;
				throw error;
			}
			this.changed();
		});
	}
	private owned(id: string, owner: Owner) {
		const record = this.records.find(
			(r) =>
				r.interaction.id === id &&
				r.owner.session === owner.session &&
				r.owner.agent === owner.agent &&
				r.owner.profile === owner.profile,
		);
		if (!record) throw new Error("Interaction does not belong to this session/profile");
		return record;
	}
	async result(id: string, owner: Owner, wait: boolean, signal: AbortSignal) {
		const record = this.owned(id, owner);
		const done = () => record.cancelled || record.interaction.completed || this.stopped;
		signal.throwIfAborted();
		if (wait && !done())
			await new Promise<void>((resolve, reject) => {
				const cleanup = () => {
					this.changes.delete(check);
					signal.removeEventListener("abort", abort);
				};
				const check = () => {
					if (done()) {
						cleanup();
						resolve();
					}
				};
				const abort = () => {
					cleanup();
					reject(signal.reason ?? new Error("Cancelled"));
				};
				this.changes.add(check);
				signal.addEventListener("abort", abort, { once: true });
				if (signal.aborted) abort();
				else check();
			});
		if (this.stopped) throw new Error("UI plugin stopped");
		return {
			id,
			status: record.cancelled ? "cancelled" : record.interaction.completed ? "completed" : "pending",
			steps: record.interaction.steps,
		};
	}
	async closeSession(session: string) {
		await this.mutate(async () => {
			const changed = this.records.filter(
				(r) => r.owner.session === session && !r.interaction.completed && !r.cancelled,
			);
			for (const r of changed) r.cancelled = true;
			try {
				await this.persist();
			} catch (error) {
				for (const r of changed) r.cancelled = false;
				throw error;
			}
			this.changed();
		});
	}
	async stop() {
		this.stopped = true;
		if (this.boardSource) this.sourceRevision++;
		this.boardSource = undefined;
		this.boardRequest = undefined;
		this.sourceAbort.abort();
		this.changed();
		await this.tail;
		await unlink(join(this.directory, "renderer.json")).catch((error) => {
			if (error.code !== "ENOENT") throw error;
		});
		try {
			if (this.desktop && this.base) {
				const path = join(this.directory, "desktop.json");
				try {
					const endpoint = JSON.parse(await readFile(path, "utf8"));
					if (endpoint.url === this.base && endpoint.pid === process.pid) await unlink(path);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
			}
		} finally {
			if (this.server) {
				const server = this.server;
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
				this.server = undefined;
			}
			this.base = "";
		}
	}
}
