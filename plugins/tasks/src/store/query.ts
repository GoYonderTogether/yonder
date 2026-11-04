import type { ToolContext } from "@yonder/sdk";
import type { TaskLedger } from "./ledger.js";
import { ongoing, own, type Projected, type Task, type TaskEvent } from "./project.js";

export const all = (ledger: TaskLedger): Projected[] => [...ledger.projects.values()];
export const count = (ledger: TaskLedger) => ledger.projects.size;
export const find = (ledger: TaskLedger, id: string): Task | undefined =>
	(ledger.projects.get(id) ?? [...ledger.projects.values()].find(({ task }) => task.ref === id))?.task;
export const history = (ledger: TaskLedger, id: string): TaskEvent[] => {
	const entry = ledger.projects.get(id) ?? [...ledger.projects.values()].find(({ task }) => task.ref === id);
	return entry ? [...(ledger.histories.get(entry.task.id) ?? [])] : [];
};

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

export function list(ledger: TaskLedger, ctx: ToolContext): Task[] {
	const tasks = all(ledger).map(({ task }) => task);
	const byId = new Map(tasks.map((task) => [task.id, task]));
	return tasks.filter((task) => permitted(task, ctx, (id) => byId.get(id)));
}

export function get(ledger: TaskLedger, id: string, ctx: ToolContext): { task: Task; history: TaskEvent[] } {
	const task = find(ledger, id);
	if (!task || !permitted(task, ctx, (parent) => find(ledger, parent))) throw new Error("Task not found for caller");
	return { task, history: history(ledger, task.id) };
}

export function progress(ledger: TaskLedger, tasks: Task[]): Map<string, string | null> {
	return new Map(
		tasks.map((task) => {
			const entry = ledger.projects.get(task.id);
			return [
				task.id,
				["waiting-user", "blocked"].includes(task.state)
					? (entry?.progressSinceState ?? null)
					: (entry?.progressAll ?? null),
			];
		}),
	);
}

export function rendered(
	ledger: TaskLedger,
	ids: string[],
	session: string,
): Map<string, { revision: number; event?: string }> {
	const out = new Map<string, { revision: number; event?: string }>();
	for (const id of ids) {
		const mark = ledger.projects.get(id)?.rendered[session];
		if (mark) out.set(id, mark);
	}
	return out;
}

export const digests = (ledger: TaskLedger, id: string): TaskEvent[] =>
	history(ledger, id).filter((event) => event.kind === "digest");

export function moments(ledger: TaskLedger, postCompact: boolean): Task[] {
	return all(ledger)
		.map(({ task }) => task)
		.filter(
			(task) =>
				task.state === "active" ||
				(task.state === "waiting-user" && Boolean(task.origin)) ||
				(task.state === "done" && postCompact),
		);
}
