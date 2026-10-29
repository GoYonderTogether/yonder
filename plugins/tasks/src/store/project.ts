import type { ToolContext } from "@yonder/sdk";

export type State = "open" | "active" | "waiting-user" | "blocked" | "review" | "done" | "cancelled";
export interface TaskContent {
	title: string;
	objective: string;
	acceptance: string[];
	nonGoals: string[];
	budget: {
		wallMinutes?: number;
		wakeups?: number;
		/** 生命周期 token 上限；触顶后只注入一次收尾提示。 */
		tokens?: number;
		/** 账本累计的 token 用量；由插件写入，调用方不能设。 */
		used?: number;
		/** 收尾提示已经注入过；由插件写入。 */
		warned?: boolean;
	};
	/** Verification contract the closer must satisfy; defaults to the acceptance points joined. */
	contract?: string;
	/** A small child task that does not gate its parent's completion. */
	lightweight?: boolean;
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
	/** 最近一次完成审计的结论；驳回时任务保持未关闭。 */
	auditResult?: AuditResult;
}
/** 独立只读审计的结论：末行 `<approved/>` 才算通过。 */
export interface AuditResult {
	verdict: "approved" | "rejected";
	reason: string;
	/** 审计会话使用的预设。 */
	preset: string;
	/** 审计会话 id，便于回看审计记录。 */
	session: string;
	at: string;
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
	/** 改挂父任务；校验成环与最大层数。 */
	parent?: string | null;
};
/** 批量更新的一项：一条普通 update 加上目标任务 id。 */
export type UpdateItem = Update & { id: string };
export interface TaskEvent {
	seq: number;
	task: string;
	kind: "open" | "update" | "done" | "wake" | "audit" | "spend" | "moment" | "moment-result" | "digest";
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
/** 算作任务进展的事件：提醒投递、用量结算与审计记录都不算。 */
export const countsAsActivity = (kind: TaskEvent["kind"]) =>
	!kind.startsWith("moment") && kind !== "digest" && kind !== "spend" && kind !== "audit";
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
	// 用量只改预算，不算进度：不推进 revision，免得每轮请求都重放详情。
	if (event.kind === "spend") {
		Object.assign(current.task, event.data);
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
