import type { DatabaseSync } from "node:sqlite";
import type { ToolContext } from "@yonder/sdk";
import { fromRow, ongoing, own, type Projected, type Task, type TaskEvent } from "./project.js";

const parse = (rows: Array<Record<string, unknown>>): TaskEvent[] =>
	rows.map((row) => ({ ...row, data: JSON.parse(String(row.data)) }) as unknown as TaskEvent);

export function all(db: DatabaseSync): Projected[] {
	return db
		.prepare("SELECT * FROM task_current ORDER BY rowid")
		.all()
		.map((row) => fromRow(row as Record<string, unknown>));
}

export function count(db: DatabaseSync): number {
	return Number((db.prepare("SELECT COUNT(*) AS n FROM task_current").get() as { n: number }).n);
}

export function find(db: DatabaseSync, id: string): Task | undefined {
	const row =
		db.prepare("SELECT * FROM task_current WHERE id = ?").get(id) ??
		db.prepare("SELECT * FROM task_current WHERE ref = ?").get(id);
	return row ? fromRow(row as Record<string, unknown>).task : undefined;
}

export function current(db: DatabaseSync, id: string): Projected | undefined {
	const row = db.prepare("SELECT * FROM task_current WHERE id = ?").get(id);
	return row ? fromRow(row as Record<string, unknown>) : undefined;
}

export function history(db: DatabaseSync, id: string): TaskEvent[] {
	return parse(
		db.prepare("SELECT * FROM events WHERE task = ? ORDER BY seq").all(id) as Array<Record<string, unknown>>,
	);
}

function permitted(task: Task, ctx: ToolContext, parentOf: (id: string) => Task | undefined): boolean {
	if (own(task, ctx) || (ctx.capabilities.includes("cross-agent") && ongoing(task))) return true;
	let parent = task.parent;
	while (parent) {
		const ancestor = parentOf(parent);
		if (!ancestor) break;
		if (own(ancestor, ctx)) return true;
		parent = ancestor.parent;
	}
	return false;
}

export function list(db: DatabaseSync, ctx: ToolContext): Task[] {
	const tasks = all(db);
	const byId = new Map(tasks.map(({ task }) => [task.id, task]));
	return tasks.map(({ task }) => task).filter((task) => permitted(task, ctx, (id) => byId.get(id)));
}

export function get(db: DatabaseSync, id: string, ctx: ToolContext): { task: Task; history: TaskEvent[] } {
	const task = find(db, id);
	if (!task || !permitted(task, ctx, (parent) => find(db, parent))) throw new Error("Task not found for caller");
	return { task, history: history(db, task.id) };
}

/** 面板只取“最近一条备注或交付”，一条 IN 查询代替逐任务 get。 */
export function progress(db: DatabaseSync, tasks: Task[]): Map<string, string | null> {
	const out = new Map<string, string | null>();
	if (!tasks.length) return out;
	const rows = db
		.prepare(`SELECT task, data FROM events WHERE task IN (${tasks.map(() => "?").join(", ")}) ORDER BY seq`)
		.all(...tasks.map(({ id }) => id)) as Array<Record<string, unknown>>;
	const grouped = new Map<string, TaskEvent["data"][]>();
	for (const row of rows) {
		const id = String(row.task);
		const data = JSON.parse(String(row.data)) as TaskEvent["data"];
		grouped.set(id, [...(grouped.get(id) ?? []), data]);
	}
	for (const task of tasks) {
		const events = grouped.get(task.id) ?? [];
		const stateIndex = events.findLastIndex((data) => data.state !== undefined);
		const relevant = ["waiting-user", "blocked"].includes(task.state) ? events.slice(stateIndex) : events;
		const latest = relevant.findLast((data) => data.note?.trim() || data.deliverable?.trim());
		out.set(task.id, latest?.note ?? latest?.deliverable ?? null);
	}
	return out;
}

/** 本轮已经渲染过的会话标记，来自 wake 事件；只在需要时按任务集合取一次。 */
export function rendered(
	db: DatabaseSync,
	ids: string[],
	session: string,
): Map<string, { revision: number; event?: string }> {
	const out = new Map<string, { revision: number; event?: string }>();
	if (!ids.length) return out;
	const rows = db
		.prepare(
			`SELECT task, data FROM events WHERE kind = 'wake' AND task IN (${ids.map(() => "?").join(", ")}) ORDER BY seq`,
		)
		.all(...ids) as Array<Record<string, unknown>>;
	for (const row of rows) {
		const data = JSON.parse(String(row.data)) as TaskEvent["data"];
		if (data.renderedSession !== session) continue;
		out.set(String(row.task), {
			revision: Number(data.renderedRevision),
			...(data.renderedEvent ? { event: data.renderedEvent } : {}),
		});
	}
	return out;
}

export function digests(db: DatabaseSync, id: string): TaskEvent[] {
	return parse(
		db.prepare("SELECT * FROM events WHERE task = ? AND kind = 'digest' ORDER BY seq").all(id) as Array<
			Record<string, unknown>
		>,
	);
}

/** 只有这些状态才可能触发 moment，其余任务不必读历史。 */
export function moments(db: DatabaseSync, postCompact: boolean): Task[] {
	return all(db)
		.map(({ task }) => task)
		.filter(
			(task) =>
				task.state === "active" ||
				(task.state === "waiting-user" && Boolean(task.origin)) ||
				(task.state === "done" && postCompact),
		);
}
