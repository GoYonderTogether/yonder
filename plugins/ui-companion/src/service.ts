import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

type Owner = Pick<ToolContext, "session" | "agent" | "profile">;
type Record = { owner: Owner; interaction: Interaction; cancelled: boolean };

export class CompanionService {
	private records: Record[] = [];
	private server: Server | undefined;
	private child: ChildProcess | undefined;
	private tail: Promise<unknown> = Promise.resolve();
	private changes = new Set<() => void>();
	private base = "";
	private stopped = true;
	constructor(
		private readonly directory: string,
		private readonly desktop: boolean,
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
	private active() {
		return this.records.find((r) => !r.cancelled && !r.interaction.completed);
	}
	async start() {
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
		const html = await readFile(new URL("../dist/index.html", import.meta.url));
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
				if (request.method === "GET" && path === "state") {
					response.writeHead(200, { "Content-Type": "application/json" }).end(
						JSON.stringify({
							active: this.active()?.interaction ?? null,
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
	private async openDesktop() {
		if (!this.desktop || process.platform !== "darwin" || this.child) return;
		const executable = fileURLToPath(new URL("../dist/Yonder UI.app/Contents/MacOS/YonderUI", import.meta.url));
		const child = spawn(executable, [], { env: { ...process.env, YONDER_UI_URL: this.base }, stdio: "ignore" });
		this.child = child;
		child.once("exit", () => {
			if (this.child === child) this.child = undefined;
		});
		child.once("error", () => {
			if (this.child === child) this.child = undefined;
		});
		await once(child, "spawn");
	}
	async present(card: unknown, owner: Owner) {
		const validated: Card = validateCard(card);
		if (this.stopped) throw new Error("UI plugin is not running");
		// Launch first so a missing native binary cannot leave an unseen queued request.
		await this.openDesktop();
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
		this.changed();
		await this.tail;
		this.child?.kill();
		this.child = undefined;
		if (this.server) {
			const server = this.server;
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			this.server = undefined;
		}
	}
}
