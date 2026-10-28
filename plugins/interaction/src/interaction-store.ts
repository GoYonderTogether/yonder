import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
} from "../state.mjs";

type Owner = Pick<ToolContext, "session" | "agent" | "profile">;
type Record = { owner: Owner; interaction: Interaction; cancelled: boolean };

export class CompanionService {
	private records: Record[] = [];
	private tail: Promise<unknown> = Promise.resolve();
	private changes = new Set<() => void>();
	private viewChanged: (() => void) | undefined;
	private viewRevision = 0;
	private stopped = true;
	constructor(private readonly directory: string) {}
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
		this.viewRevision++;
		this.viewChanged?.();
		for (const notify of this.changes) notify();
	}
	onViewChanged(notify: () => void) {
		this.viewChanged = notify;
	}
	view(session?: string) {
		const record = this.active();
		return {
			revision: this.viewRevision,
			interaction: session && record?.owner.session === session ? record.interaction : undefined,
		};
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
		this.stopped = false;
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
	}
}
