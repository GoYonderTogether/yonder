import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RenderContext, ToolContext } from "@yonder/sdk";
import { TURN_ONE_LINE } from "./prompts.js";

export type State = "open" | "active" | "waiting-user" | "blocked" | "review" | "done" | "cancelled";
export interface TaskContent {
	title: string;
	objective: string;
	acceptance: string[];
	nonGoals: string[];
	budget: { wallMinutes?: number; wakeups?: number };
}
export interface Task extends TaskContent {
	id: string;
	ownerAgent: string | null;
	session: string;
	parent: string | null;
	state: State;
	deliverable: string | null;
	evidence: string[];
	origin?: string;
	createdAt: string;
	lastActivityAt: string;
	lastDeliveryAt: string | null;
	wakeups: number;
}
export type Open = Omit<TaskContent, "budget"> & {
	budget?: TaskContent["budget"];
	parent?: string;
	origin?: string;
};
export type Update = Partial<TaskContent> & {
	state?: Exclude<State, "open" | "done">;
	deliverable?: string;
	note?: string;
};
interface TaskEvent {
	seq: number;
	task: string;
	kind: "open" | "update" | "done" | "wake" | "moment" | "moment-result";
	at: string;
	data: Partial<Task> & {
		note?: string;
		renderedRevision?: number;
		renderedSession?: string;
		renderedEvent?: string;
		counted?: boolean;
		moment?: Moment;
		result?: unknown;
		error?: string;
	};
}
export type Moment = "stall" | "user-wait" | "postCompact";
interface Current {
	task: Task;
	revision: number;
	rendered: Map<string, { revision: number; event?: string }>;
}
const transitions: Record<State, State[]> = {
	open: ["active", "cancelled"],
	active: ["waiting-user", "blocked", "review", "cancelled"],
	"waiting-user": ["active", "blocked", "review", "done", "cancelled"],
	blocked: ["active", "waiting-user", "review", "done", "cancelled"],
	review: ["active", "waiting-user", "blocked", "done", "cancelled"],
	done: [],
	cancelled: [],
};
const ongoing = (task: Task) => task.state !== "done" && task.state !== "cancelled";
const own = (task: Task, ctx: Pick<ToolContext, "agent" | "session">) =>
	task.ownerAgent === null ? ctx.agent === null && task.session === ctx.session : task.ownerAgent === ctx.agent;
const minutes = (since: string, now: number) => `${Math.floor((now - Date.parse(since)) / 60000)}m`;

export class Store {
	constructor(private readonly data: string) {}
	private use<T>(fn: (db: DatabaseSync) => T): T {
		mkdirSync(this.data, { recursive: true, mode: 0o700 });
		const path = join(this.data, "tasks.sqlite");
		const db = new DatabaseSync(path);
		try {
			chmodSync(path, 0o600);
			db.exec(`CREATE TABLE IF NOT EXISTS events (
				seq INTEGER PRIMARY KEY, task TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL
			)`);
			return fn(db);
		} finally {
			db.close();
		}
	}
	private events(db: DatabaseSync): TaskEvent[] {
		return db
			.prepare("SELECT * FROM events ORDER BY seq")
			.all()
			.map((row) => ({
				...row,
				data: JSON.parse(String(row.data)),
			})) as unknown as TaskEvent[];
	}
	private current(events: TaskEvent[]): Map<string, Current> {
		// ponytail: replay the local ledger; index only if measured ledger size requires it.
		const tasks = new Map<string, Current>();
		for (const event of events) {
			if (event.kind === "moment" || event.kind === "moment-result") continue;
			if (event.kind === "open") {
				tasks.set(event.task, { task: structuredClone(event.data) as Task, revision: event.seq, rendered: new Map() });
				continue;
			}
			const current = tasks.get(event.task)!;
			if (event.kind === "wake") {
				if (event.data.counted !== false) current.task.wakeups++;
				current.rendered.set(event.data.renderedSession!, {
					revision: event.data.renderedRevision!,
					...(event.data.renderedEvent ? { event: event.data.renderedEvent } : {}),
				});
			} else {
				const { note: _, ...patch } = event.data;
				Object.assign(current.task, patch);
				current.revision = event.seq;
			}
		}
		return tasks;
	}
	private append(db: DatabaseSync, task: string, kind: TaskEvent["kind"], data: TaskEvent["data"], now = Date.now()) {
		db.prepare("INSERT INTO events(task, kind, at, data) VALUES (?, ?, ?, ?)").run(
			task,
			kind,
			new Date(now).toISOString(),
			JSON.stringify(data),
		);
	}
	private visible(task: Task, tasks: Map<string, Current>, ctx: ToolContext): boolean {
		if (own(task, ctx) || (ctx.capabilities.includes("cross-agent") && ongoing(task))) return true;
		let parent = task.parent;
		while (parent) {
			const ancestor = tasks.get(parent)?.task;
			if (!ancestor) break;
			if (own(ancestor, ctx)) return true;
			parent = ancestor.parent;
		}
		return false;
	}
	open(args: Open, ctx: ToolContext): Task {
		return this.use((db) => {
			if (args.parent && !this.current(this.events(db)).has(args.parent)) throw new Error("Parent task not found");
			const now = new Date().toISOString();
			const task: Task = {
				id: randomUUID(),
				ownerAgent: ctx.agent,
				session: ctx.session,
				parent: args.parent ?? null,
				title: args.title,
				objective: args.objective,
				acceptance: args.acceptance,
				nonGoals: args.nonGoals,
				budget: args.budget ?? {},
				state: "open",
				deliverable: null,
				evidence: [],
				origin: args.origin ?? ctx.event?.conv ?? `session:${ctx.session}`,
				createdAt: now,
				lastActivityAt: now,
				lastDeliveryAt: null,
				wakeups: 0,
			};
			this.append(db, task.id, "open", task);
			return task;
		});
	}
	update(id: string, args: Update, ctx: ToolContext): Task {
		return this.change(id, args, ctx);
	}
	done(id: string, deliverable: string, evidence: string[], ctx: ToolContext): Task {
		return this.change(id, { state: "done", deliverable, evidence }, ctx);
	}
	private change(id: string, patch: Partial<Task> & { note?: string }, ctx: ToolContext): Task {
		return this.use((db) => {
			const task = this.current(this.events(db)).get(id)?.task;
			if (!task || !own(task, ctx)) throw new Error("Task not found for caller");
			if (!ongoing(task)) throw new Error("Task is closed");
			if (patch.state && patch.state !== task.state && !transitions[task.state].includes(patch.state))
				throw new Error(`Invalid task transition: ${task.state} -> ${patch.state}`);
			if (
				patch.state === "done" &&
				(!patch.deliverable?.trim() ||
					!Array.isArray(patch.evidence) ||
					patch.evidence.length !== task.acceptance.length ||
					patch.evidence.some((entry) => typeof entry !== "string" || !entry.trim()))
			)
				throw new Error("Done requires a deliverable and one evidence entry per acceptance point");
			patch.lastActivityAt = new Date().toISOString();
			if (patch.deliverable?.trim()) patch.lastDeliveryAt = patch.lastActivityAt;
			this.append(db, id, patch.state === "done" ? "done" : "update", patch);
			const { note: _, ...fields } = patch;
			return { ...task, ...fields };
		});
	}
	list(ctx: ToolContext): Task[] {
		return this.use((db) => {
			const tasks = this.current(this.events(db));
			return [...tasks.values()].map((c) => c.task).filter((task) => this.visible(task, tasks, ctx));
		});
	}
	get(id: string, ctx: ToolContext): { task: Task; history: TaskEvent[] } {
		return this.use((db) => {
			const events = this.events(db),
				tasks = this.current(events),
				task = tasks.get(id)?.task;
			if (!task || !this.visible(task, tasks, ctx)) throw new Error("Task not found for caller");
			return { task, history: events.filter((event) => event.task === id) };
		});
	}
	claimMoments(now: number, stallMinutes: number, userWaitMinutes: number, postCompact: boolean) {
		return this.use((db) => {
			const events = this.events(db);
			const due: Array<{ task: Task; moment: Moment; minutes: number; waitingFor: string }> = [];
			for (const { task } of this.current(events).values()) {
				const history = events.filter((event) => event.task === task.id);
				const activity = history.filter((event) => !event.kind.startsWith("moment")).at(-1)!;
				const done = history.find((event) => event.kind === "done");
				const moment: Moment | undefined =
					task.state === "active"
						? "stall"
						: task.state === "waiting-user" && task.origin
							? "user-wait"
							: task.state === "done" && postCompact
								? "postCompact"
								: undefined;
				if (!moment) continue;
				const last = history.findLast((event) => event.kind === "moment" && event.data.moment === moment);
				const since =
					moment === "postCompact"
						? done!.at
						: moment === "user-wait"
							? history.findLast((event) => event.data.state === "waiting-user")!.at
							: activity.at;
				const window = moment === "stall" ? stallMinutes : moment === "user-wait" ? userWaitMinutes : 15;
				if (moment === "postCompact" && last) continue;
				if (now - Math.max(Date.parse(since), last ? Date.parse(last.at) : 0) < window * 60000) continue;
				this.append(db, task.id, "moment", { moment }, now);
				due.push({
					task,
					moment,
					minutes: Math.floor((now - Date.parse(since)) / 60000),
					waitingFor: history.findLast((event) => event.data.note)?.data.note ?? task.objective,
				});
			}
			return due;
		});
	}
	momentResult(id: string, moment: Moment, data: { result?: unknown; error?: string }, now: number) {
		this.use((db) => this.append(db, id, "moment-result", { moment, ...data }, now));
	}
	recentlyDone(task: Task, now = Date.now()): boolean {
		return task.state === "done" && now - Date.parse(task.lastActivityAt) < 30 * 60000;
	}
	render(ctx: RenderContext): string | undefined {
		ctx.signal?.throwIfAborted();
		return this.use((db) => {
			const tasks = this.current(this.events(db));
			const lines: string[] = [];
			for (const current of tasks.values()) {
				const task = current.task;
				if (!own(task, { agent: ctx.agent || null, session: ctx.session }) || !ongoing(task)) continue;
				const now = Date.now();
				const rendered = current.rendered.get(ctx.session);
				const counted = !ctx.event || rendered?.event !== ctx.event.id;
				const line = TURN_ONE_LINE(
					task.title,
					task.state,
					minutes(task.createdAt, now),
					task.wakeups + Number(counted),
					minutes(task.lastDeliveryAt ?? task.createdAt, now),
				);
				lines.push(
					rendered?.revision === current.revision
						? line
						: `${line}\n${JSON.stringify({ ...task, wakeups: task.wakeups + Number(counted) })}`,
				);
				if (counted || rendered?.revision !== current.revision)
					this.append(db, task.id, "wake", {
						renderedSession: ctx.session,
						renderedRevision: current.revision,
						counted,
						...(ctx.event ? { renderedEvent: ctx.event.id } : {}),
					});
			}
			return lines.length ? lines.join("\n\n") : undefined;
		});
	}
}
