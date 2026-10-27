import type { ToolContext } from "@yonder/sdk";

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
	ref: string;
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
export interface TaskEvent {
	seq: number;
	task: string;
	kind: "open" | "update" | "done" | "wake" | "moment" | "moment-result" | "digest";
	at: string;
	data: Partial<Task> & {
		destination?: string;
		fingerprint?: string;
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

/** 投影表里的一行：当前态 + 产生该态的事件序号。 */
export interface Projected {
	task: Task;
	revision: number;
}

export const transitions: Record<State, State[]> = {
	open: ["active", "cancelled"],
	active: ["waiting-user", "blocked", "review", "cancelled"],
	"waiting-user": ["active", "blocked", "review", "done", "cancelled"],
	blocked: ["active", "waiting-user", "review", "done", "cancelled"],
	review: ["active", "waiting-user", "blocked", "done", "cancelled"],
	done: [],
	cancelled: [],
};
export const ongoing = (task: Task) => task.state !== "done" && task.state !== "cancelled";
export const own = (task: Task, ctx: Pick<ToolContext, "agent" | "session">) =>
	task.ownerAgent === null ? ctx.agent === null && task.session === ctx.session : task.ownerAgent === ctx.agent;

/**
 * 把一条事件折进当前态映射。投影与全量 replay 共用这一份规则，
 * 两种算法才不会各自漂移。
 */
export function applyEvent(map: Map<string, Projected>, event: TaskEvent): void {
	if (event.kind === "moment" || event.kind === "moment-result" || event.kind === "digest") return;
	if (event.kind === "open") {
		map.set(event.task, {
			task: { ...structuredClone(event.data), ref: event.data.ref ?? `T${map.size + 1}` } as Task,
			revision: event.seq,
		});
		return;
	}
	const current = map.get(event.task);
	// 缺 open 的坏事件只丢它自己，不连累同一本账的其它任务。
	if (!current) return;
	if (event.kind === "wake") {
		if (event.data.counted !== false) current.task.wakeups++;
		return;
	}
	const { note: _, ...patch } = event.data;
	Object.assign(current.task, patch);
	current.revision = event.seq;
}

export function replay(events: Iterable<TaskEvent>): Map<string, Projected> {
	const map = new Map<string, Projected>();
	for (const event of events) applyEvent(map, event);
	return map;
}

/** 投影表行；列是查询要用的字段，record 存其余字段。 */
export interface Row {
	id: string;
	ref: string;
	title: string;
	state: State;
	owner: string | null;
	parent: string | null;
	session: string;
	origin: string | null;
	revision: number;
	record: string;
}

export function toRow({ task, revision }: Projected): Row {
	const { id, ref, title, state, ownerAgent, parent, session, origin, ...record } = task;
	return {
		id,
		ref,
		title,
		state,
		owner: ownerAgent,
		parent,
		session,
		origin: origin ?? null,
		revision,
		record: JSON.stringify(record),
	};
}

export function fromRow(row: Record<string, unknown>): Projected {
	const record = JSON.parse(String(row.record)) as Omit<
		Task,
		"id" | "ref" | "title" | "state" | "ownerAgent" | "parent" | "session" | "origin"
	>;
	const origin = row.origin === null || row.origin === undefined ? {} : { origin: String(row.origin) };
	return {
		task: {
			...record,
			id: String(row.id),
			ref: String(row.ref),
			title: String(row.title),
			state: row.state as State,
			ownerAgent: row.owner === null ? null : String(row.owner),
			parent: row.parent === null ? null : String(row.parent),
			session: String(row.session),
			...origin,
		} as Task,
		revision: Number(row.revision),
	};
}
