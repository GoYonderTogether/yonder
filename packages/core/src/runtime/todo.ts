import { Type } from "typebox";

/** Any strict-JSON value; the session doc stores the list verbatim, so metadata must be JSON. */
export type TodoMetadataValue =
	| null
	| boolean
	| number
	| string
	| TodoMetadataValue[]
	| { [key: string]: TodoMetadataValue };
export type TodoMetadata = Record<string, TodoMetadataValue>;

/** rpiv-todo task states: pending → in_progress → completed, plus the deleted tombstone. */
export type TodoStatus = "pending" | "in_progress" | "completed" | "deleted";

export type TodoTask = {
	id: number;
	subject: string;
	description?: string;
	activeForm?: string;
	status: TodoStatus;
	blockedBy: number[];
	/** Arbitrary JSON attached by the model; never interpreted by the harness. */
	metadata?: TodoMetadata;
};

/** Session-owned todo list; `next` is the next id. `clear` resets both. */
export type TodoList = {
	next: number;
	tasks: TodoTask[];
};

export interface TodoArgs {
	action: "create" | "update" | "list" | "get" | "delete" | "clear";
	id?: number;
	subject?: string;
	description?: string;
	activeForm?: string;
	status?: TodoStatus;
	blockedBy?: number[];
	metadata?: TodoMetadata;
	addBlockedBy?: number[];
	removeBlockedBy?: number[];
	includeDeleted?: boolean;
}

/** contracts §3.4 `todo.updated`: full replacement of the session's list. */
export interface TodoUpdatedEvent {
	session: string;
	done: number;
	total: number;
	items: Array<{
		id: string;
		text: string;
		state: "todo" | "doing" | "done" | "cancelled";
		order: number;
	}>;
}

const id = Type.Integer({ minimum: 1 });
const ids = Type.Array(id, { uniqueItems: true });
const status = Type.Union([
	Type.Literal("pending"),
	Type.Literal("in_progress"),
	Type.Literal("completed"),
	Type.Literal("deleted"),
]);

export const todoParameters = Type.Object(
	{
		action: Type.Union(["create", "update", "list", "get", "delete", "clear"].map((action) => Type.Literal(action))),
		id: Type.Optional(id),
		subject: Type.Optional(Type.String({ minLength: 1, description: "Short imperative title (create, update)" })),
		description: Type.Optional(Type.String()),
		activeForm: Type.Optional(Type.String({ description: "Present-continuous label shown while in_progress" })),
		status: Type.Optional(status),
		blockedBy: Type.Optional(ids),
		metadata: Type.Optional(
			Type.Record(Type.String(), Type.Unknown(), {
				description: "Arbitrary metadata; pass null value for a key to delete that key on update",
			}),
		),
		addBlockedBy: Type.Optional(ids),
		removeBlockedBy: Type.Optional(ids),
		includeDeleted: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

export const todoDescription =
	"Track multi-step work in this session. Actions: create (subject, optional description/activeForm/blockedBy), update (id; status, subject, description, activeForm, addBlockedBy, removeBlockedBy), list (optional status filter, includeDeleted), get (id), delete (tombstone), clear (reset). Status moves pending → in_progress → completed; deleted is a tombstone. blockedBy names task ids that must finish first; cycles are rejected. Keep exactly one task in_progress.";

const transitions: Record<TodoStatus, readonly TodoStatus[]> = {
	pending: ["in_progress", "completed", "deleted"],
	in_progress: ["pending", "completed", "deleted"],
	completed: ["deleted"],
	deleted: [],
};

export const emptyTodos = (): TodoList => ({ next: 1, tasks: [] });

function line(task: TodoTask): string {
	const blocked = task.blockedBy.length ? ` (blocked by ${task.blockedBy.map((n) => `#${n}`).join(", ")})` : "";
	return `#${task.id} [${task.status}] ${task.subject}${blocked}`;
}

/** Whether `from` can reach `to` through blockedBy edges. */
function reaches(tasks: readonly TodoTask[], from: number, to: number): boolean {
	const seen = new Set<number>();
	const stack = [from];
	while (stack.length) {
		const at = stack.pop()!;
		if (at === to) return true;
		if (seen.has(at)) continue;
		seen.add(at);
		stack.push(...(tasks.find((task) => task.id === at)?.blockedBy ?? []));
	}
	return false;
}
/** Merge a metadata patch: a null value deletes that key, anything else replaces it. */
function mergeMetadata(current: TodoMetadata | undefined, patch: TodoMetadata | undefined): TodoMetadata | undefined {
	if (!patch) return current;
	const next: TodoMetadata = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		if (value === null) delete next[key];
		else next[key] = value;
	}
	return Object.keys(next).length ? next : undefined;
}

/**
 * Apply one tool call. Returns the new list when it changed, and the text for the model. Invalid calls throw with a
 * message the model can act on and leave the list unchanged.
 */
export function applyTodo(list: TodoList, args: TodoArgs): { list?: TodoList; text: string } {
	const tasks = list.tasks.map((task) => ({ ...task, blockedBy: [...task.blockedBy] }));
	const find = (n: number | undefined) => {
		if (n === undefined) throw new Error(`${args.action} requires id`);
		const task = tasks.find((item) => item.id === n);
		if (!task) throw new Error(`Task #${n} does not exist`);
		return task;
	};
	const checkBlockers = (task: TodoTask, blockers: readonly number[]) => {
		for (const n of blockers) {
			if (n === task.id) throw new Error(`Task #${n} cannot block itself`);
			if (find(n).status === "deleted") throw new Error(`Task #${n} is deleted`);
			if (reaches(tasks, n, task.id)) throw new Error(`Blocking #${task.id} on #${n} would create a cycle`);
		}
	};
	switch (args.action) {
		case "list": {
			const shown = tasks.filter((task) =>
				args.status ? task.status === args.status : args.includeDeleted || task.status !== "deleted",
			);
			return { text: shown.length ? shown.map(line).join("\n") : "No tasks." };
		}
		case "get": {
			const task = find(args.id);
			return {
				text: [
					line(task),
					...(task.description ? [task.description] : []),
					...(task.activeForm ? [`activeForm: ${task.activeForm}`] : []),
					...(task.metadata ? [`metadata: ${JSON.stringify(task.metadata)}`] : []),
				].join("\n"),
			};
		}
		case "clear":
			return { list: emptyTodos(), text: "Cleared all tasks." };
		case "create": {
			const metadata = mergeMetadata(undefined, args.metadata);
			if (!args.subject?.trim()) throw new Error("create requires subject");
			const task: TodoTask = {
				id: list.next,
				subject: args.subject.trim(),
				...(args.description ? { description: args.description } : {}),
				...(args.activeForm ? { activeForm: args.activeForm } : {}),
				status: "pending",
				blockedBy: [],
				...(metadata ? { metadata } : {}),
			};
			tasks.push(task);
			checkBlockers(task, args.blockedBy ?? []);
			task.blockedBy = [...(args.blockedBy ?? [])];
			return { list: { next: list.next + 1, tasks }, text: `Created ${line(task)}` };
		}
		case "delete":
		case "update": {
			const task = find(args.id);
			const target = args.action === "delete" ? "deleted" : args.status;
			if (task.status === "deleted") throw new Error(`Task #${task.id} is deleted`);
			if (target && target !== task.status) {
				if (!transitions[task.status].includes(target))
					throw new Error(`Task #${task.id} cannot move from ${task.status} to ${target}`);
				if (target === "in_progress") {
					const active = tasks.find((item) => item.status === "in_progress" && item.id !== task.id);
					if (active)
						throw new Error(
							`Task #${active.id} is already in progress; complete or reset it before starting #${task.id}`,
						);
					const open = task.blockedBy.filter((n) => {
						const status = tasks.find((item) => item.id === n)?.status;
						return status !== undefined && status !== "completed" && status !== "deleted";
					});
					if (open.length)
						throw new Error(
							`Task #${task.id} is blocked by ${open.map((n) => `#${n}`).join(", ")}; finish those first`,
						);
				}
				task.status = target;
			}
			if (args.action === "update") {
				const changed =
					args.status !== undefined ||
					args.subject !== undefined ||
					args.description !== undefined ||
					args.activeForm !== undefined ||
					args.addBlockedBy !== undefined ||
					args.removeBlockedBy !== undefined ||
					args.metadata !== undefined;
				if (!changed) throw new Error("update requires a field to change");
				if (args.subject !== undefined) {
					if (!args.subject.trim()) throw new Error("subject cannot be empty");
					task.subject = args.subject.trim();
				}
				if (args.description !== undefined) task.description = args.description;
				if (args.activeForm !== undefined) task.activeForm = args.activeForm;
				if (args.metadata !== undefined) {
					const next = mergeMetadata(task.metadata, args.metadata);
					if (next) task.metadata = next;
					else delete task.metadata;
				}
				const removed = new Set(args.removeBlockedBy ?? []);
				task.blockedBy = task.blockedBy.filter((n) => !removed.has(n));
				const added = (args.addBlockedBy ?? []).filter((n) => !task.blockedBy.includes(n));
				checkBlockers(task, added);
				task.blockedBy.push(...added);
			}
			return {
				list: { next: list.next, tasks },
				text: `${args.action === "delete" ? "Deleted" : "Updated"} ${line(task)}`,
			};
		}
	}
}

const states = { pending: "todo", in_progress: "doing", completed: "done", deleted: "cancelled" } as const;

export function todoEvent(session: string, list: TodoList): TodoUpdatedEvent {
	return {
		session,
		done: list.tasks.filter((task) => task.status === "completed").length,
		total: list.tasks.filter((task) => task.status !== "deleted").length,
		items: list.tasks.map((task, order) => ({
			id: String(task.id),
			text: task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject,
			state: states[task.status],
			order,
		})),
	};
}
