import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RenderContext, ToolContext } from "@yonder/sdk";
import { TURN_ONE_LINE } from "../prompts.js";
import {
	applyEvent,
	type Moment,
	type Open,
	ongoing,
	own,
	type Projected,
	type Task,
	type TaskEvent,
	toRow,
	transitions,
} from "./project.js";
import { all, count, current, digests, find, history, moments, rendered } from "./query.js";

const minutes = (since: string, now: number) => `${Math.floor((now - Date.parse(since)) / 60000)}m`;

export function writeRow(db: DatabaseSync, projected: Projected): void {
	const row = toRow(projected);
	db.prepare(`INSERT INTO task_current(id, ref, title, state, owner, parent, session, origin, revision, record)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET ref = excluded.ref, title = excluded.title, state = excluded.state,
			owner = excluded.owner, parent = excluded.parent, session = excluded.session, origin = excluded.origin,
			revision = excluded.revision, record = excluded.record`).run(
		row.id,
		row.ref,
		row.title,
		row.state,
		row.owner,
		row.parent,
		row.session,
		row.origin,
		row.revision,
		row.record,
	);
}

const projects = new Set<TaskEvent["kind"]>(["open", "update", "done", "wake"]);

/** 事件与投影必须一起落地：读到半个状态比读得慢更糟。 */
export function append(
	db: DatabaseSync,
	task: string,
	kind: TaskEvent["kind"],
	data: TaskEvent["data"],
	now = Date.now(),
): number {
	const at = new Date(now).toISOString();
	db.exec("BEGIN IMMEDIATE");
	try {
		const result = db
			.prepare("INSERT INTO events(task, kind, at, data) VALUES (?, ?, ?, ?)")
			.run(task, kind, at, JSON.stringify(data));
		const seq = Number(result.lastInsertRowid);
		if (projects.has(kind)) {
			const map = new Map<string, Projected>();
			const existing = current(db, task);
			if (existing) map.set(task, existing);
			applyEvent(map, { seq, task, kind, at, data } as TaskEvent);
			const next = map.get(task);
			if (next) writeRow(db, next);
		}
		db.exec("COMMIT");
		return seq;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

export function openTask(db: DatabaseSync, args: Open, ctx: ToolContext): Task {
	const parent = args.parent ? find(db, args.parent) : undefined;
	if (args.parent && !parent) throw new Error("Parent task not found");
	const now = new Date().toISOString();
	const task: Task = {
		id: randomUUID(),
		// 短号沿用账本里的开单序号，投影里的行数就是已开单数。
		ref: `T${count(db) + 1}`,
		ownerAgent: ctx.agent,
		session: ctx.session,
		parent: parent?.id ?? null,
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
	append(db, task.id, "open", task);
	return task;
}

export function changeTask(
	db: DatabaseSync,
	id: string,
	patch: Partial<Task> & { note?: string },
	ctx: ToolContext,
): Task {
	const task = find(db, id);
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
	append(db, task.id, patch.state === "done" ? "done" : "update", patch);
	const { note: _, ...fields } = patch;
	return { ...task, ...fields };
}

export function claimMoments(
	db: DatabaseSync,
	now: number,
	stallMinutes: number,
	userWaitMinutes: number,
	postCompact: boolean,
) {
	const due: Array<{ task: Task; moment: Moment; minutes: number; waitingFor: string }> = [];
	// 只对状态命中、可能需要提醒的任务读历史，与账本总量无关。
	for (const task of moments(db, postCompact)) {
		const events = history(db, task.id);
		const activity = events.filter((event) => !event.kind.startsWith("moment") && event.kind !== "digest").at(-1)!;
		const done = events.find((event) => event.kind === "done");
		const moment: Moment | undefined =
			task.state === "active"
				? "stall"
				: task.state === "waiting-user" && task.origin
					? "user-wait"
					: task.state === "done" && postCompact
						? "postCompact"
						: undefined;
		if (!moment) continue;
		const last = events.findLast((event) => event.kind === "moment" && event.data.moment === moment);
		const since =
			moment === "postCompact"
				? done!.at
				: moment === "user-wait"
					? events.findLast((event) => event.data.state === "waiting-user")!.at
					: activity.at;
		const window = moment === "stall" ? stallMinutes : moment === "user-wait" ? userWaitMinutes : 15;
		if (moment === "postCompact" && last) continue;
		if (now - Math.max(Date.parse(since), last ? Date.parse(last.at) : 0) < window * 60000) continue;
		append(db, task.id, "moment", { moment }, now);
		due.push({
			task,
			moment,
			minutes: Math.floor((now - Date.parse(since)) / 60000),
			waitingFor: events.findLast((event) => event.data.note)?.data.note ?? task.objective,
		});
	}
	return due;
}

export function momentResult(
	db: DatabaseSync,
	id: string,
	moment: Moment,
	data: { result?: unknown; error?: string },
	now: number,
): void {
	append(db, id, "moment-result", { moment, ...data }, now);
}

export function renderTurn(db: DatabaseSync, ctx: RenderContext): string | undefined {
	ctx.signal?.throwIfAborted();
	const now = Date.now();
	const mine = (task: Task) => own(task, { agent: ctx.agent || null, session: ctx.session }) && ongoing(task);
	const tasks = all(db).filter(({ task }) => mine(task));
	const marks = rendered(
		db,
		tasks.map(({ task }) => task.id),
		ctx.session,
	);
	const lines: string[] = [];
	for (const { task, revision } of tasks) {
		const mark = marks.get(task.id);
		const counted = !ctx.event || mark?.event !== ctx.event.id;
		const line = TURN_ONE_LINE(
			task.title,
			task.state,
			minutes(task.createdAt, now),
			task.wakeups + Number(counted),
			minutes(task.lastDeliveryAt ?? task.createdAt, now),
		);
		lines.push(
			mark?.revision === revision
				? line
				: `${line}\n${JSON.stringify({ ...task, wakeups: task.wakeups + Number(counted) })}`,
		);
		if (counted || mark?.revision !== revision)
			append(db, task.id, "wake", {
				renderedSession: ctx.session,
				renderedRevision: revision,
				counted,
				...(ctx.event ? { renderedEvent: ctx.event.id } : {}),
			});
	}
	return lines.length ? lines.join("\n\n") : undefined;
}

const digestFingerprint = (task: Task) =>
	JSON.stringify(
		["waiting-user", "review", "blocked"].includes(task.state)
			? [task.state, task.lastActivityAt, task.lastDeliveryAt, task.deliverable]
			: [task.lastDeliveryAt, task.deliverable],
	);

export function claimDigest(db: DatabaseSync, task: Task, destination: string, now: number): boolean {
	const fingerprint = digestFingerprint(task);
	const last = digests(db, task.id).findLast((event) => event.data.destination === destination);
	if (last?.data.fingerprint === fingerprint) return false;
	append(db, task.id, "digest", { destination, fingerprint, lastDeliveryAt: task.lastDeliveryAt }, now);
	return true;
}

export function digestSeen(db: DatabaseSync, task: Task, destination: string): boolean {
	return digests(db, task.id).some(
		(event) =>
			event.data.destination === destination &&
			(event.data.fingerprint === digestFingerprint(task) ||
				(!["waiting-user", "review", "blocked"].includes(task.state) &&
					event.data.lastDeliveryAt === task.lastDeliveryAt)),
	);
}
