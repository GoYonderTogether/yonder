import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { parseRef, type RenderContext, type ToolContext } from "@yonder/sdk";
import { TURN_ONE_LINE } from "../prompts.js";
import { auditorRejection } from "../views.js";
import {
	type AuditResult,
	applyEvent,
	countsAsActivity,
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

const projects = new Set<TaskEvent["kind"]>(["open", "update", "done", "wake", "audit", "spend"]);

/** 事件与投影必须一起落地：读到半个状态比读得慢更糟。 */
export function append(
	db: DatabaseSync,
	task: string,
	kind: TaskEvent["kind"],
	data: TaskEvent["data"],
	now = Date.now(),
	inTransaction = false,
): number {
	const at = new Date(now).toISOString();
	if (!inTransaction) db.exec("BEGIN IMMEDIATE");
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
		if (!inTransaction) db.exec("COMMIT");
		return seq;
	} catch (error) {
		if (!inTransaction) db.exec("ROLLBACK");
		throw error;
	}
}

/** 任务树最深两层：根任务之下还能挂一层子任务。 */
export const MAX_DEPTH = 2;

/** 新任务挂在 `parent` 下时的祖先数：父任务自身算一层，再往上数。 */
function depthUnder(db: DatabaseSync, parent: Task): number {
	let depth = 1;
	let cursor = parent;
	while (cursor.parent) {
		const next = find(db, cursor.parent);
		if (!next) break;
		depth += 1;
		cursor = next;
	}
	return depth;
}

/** 父任务必须存在、不能落在自己子树里（成环）、且不能超过 MAX_DEPTH。 */
function checkParent(db: DatabaseSync, parentId: string, task?: Task): Task {
	const parent = find(db, parentId);
	if (!parent) throw new Error("Parent task not found");
	if (task) {
		let cursor: Task | undefined = parent;
		while (cursor) {
			if (cursor.id === task.id) throw new Error("A task cannot be nested under itself");
			cursor = cursor.parent ? find(db, cursor.parent) : undefined;
		}
	}
	if (depthUnder(db, parent) > MAX_DEPTH) throw new Error(`Task nesting is limited to ${MAX_DEPTH} levels`);
	return parent;
}

/** 同一阻塞要连续报三次才允许标 blocked：投递、用量和审计事件不算一轮报告。 */
export const BLOCKER_ROUNDS = 3;

const quiet = (kind: TaskEvent["kind"]) =>
	kind === "wake" || kind === "spend" || kind === "audit" || kind === "digest" || kind.startsWith("moment");

const normalizeBlocker = (note: string) => note.replace(/\s+/gu, " ").trim().toLowerCase();

/** 从最近一条报告往回数：同一个阻塞连着报了几轮，遇到别的进展就停。 */
function blockerRounds(db: DatabaseSync, id: string, note: string): number {
	const wanted = normalizeBlocker(note);
	let rounds = 0;
	for (const event of history(db, id).reverse()) {
		if (quiet(event.kind)) continue;
		if (event.kind !== "update" || !event.data.note || normalizeBlocker(event.data.note) !== wanted) break;
		rounds += 1;
	}
	return rounds;
}

export function openTask(db: DatabaseSync, args: Open, ctx: ToolContext): Task {
	const parent = args.parent ? checkParent(db, args.parent) : undefined;
	const origin = args.origin ?? ctx.event?.conv;
	if (origin !== undefined) {
		try {
			if (parseRef(origin).kind !== "conv") throw new Error();
		} catch {
			throw new Error("Task origin must be a valid conversation reference (conv:channel:id)");
		}
	}
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
		contract: args.contract ?? args.acceptance.join("; "),
		...(args.lightweight ? { lightweight: true } : {}),
		budget: args.budget ?? {},
		state: "open",
		deliverable: null,
		evidence: [],
		...(origin ? { origin } : {}),
		createdAt: now,
		lastActivityAt: now,
		lastDeliveryAt: null,
		wakeups: 0,
	};
	append(db, task.id, "open", task);
	return task;
}

/** 一条 patch 的全部校验与落地；批量更新在同一条事务里复用它。 */
function change(
	db: DatabaseSync,
	id: string,
	patch: Partial<Task> & { note?: string },
	ctx: ToolContext,
	inTransaction: boolean,
): Task {
	const task = find(db, id);
	if (!task || !own(task, ctx)) throw new Error("Task not found for caller");
	if (!ongoing(task)) throw new Error("Task is closed");
	if (patch.state && patch.state !== task.state && !transitions[task.state].includes(patch.state))
		throw new Error(`Invalid task transition: ${task.state} -> ${patch.state}`);
	if (patch.state === "blocked" && patch.state !== task.state) {
		const note = patch.note?.trim();
		if (!note) throw new Error("Blocking a task requires a note saying what blocks it");
		const rounds = blockerRounds(db, task.id, note) + 1;
		if (rounds < BLOCKER_ROUNDS)
			throw new Error(
				`Blocking needs the same blocker reported on ${BLOCKER_ROUNDS} consecutive updates; this is report ${rounds} of ${BLOCKER_ROUNDS}. Keep the task active, report the blocker again with tasks_update next turn, and mark it blocked on report ${BLOCKER_ROUNDS}.`,
			);
	}
	if (patch.parent !== undefined && patch.parent !== null && patch.parent !== task.parent)
		patch.parent = checkParent(db, patch.parent, task).id;
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
	append(db, task.id, patch.state === "done" ? "done" : "update", patch, Date.now(), inTransaction);
	const { note: _, ...fields } = patch;
	return { ...task, ...fields };
}

export function changeTask(
	db: DatabaseSync,
	id: string,
	patch: Partial<Task> & { note?: string },
	ctx: ToolContext,
): Task {
	return change(db, id, patch, ctx, false);
}

/** 一批更新要么全部落地、要么一条都不留：任一条不合法就回滚整批。 */
export function changeTasks(
	db: DatabaseSync,
	updates: ReadonlyArray<{ id: string } & Partial<Task> & { note?: string }>,
	ctx: ToolContext,
): Task[] {
	if (!updates.length) throw new Error("updates requires at least one entry");
	db.exec("BEGIN IMMEDIATE");
	try {
		const changed = updates.map(({ id, ...patch }) => change(db, id, patch, ctx, true));
		db.exec("COMMIT");
		return changed;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

export function claimMoments(
	db: DatabaseSync,
	now: number,
	stallMinutes: number,
	userWaitMinutes: number,
	postCompact: boolean,
) {
	db.exec("BEGIN IMMEDIATE");
	try {
		const due: Array<{ task: Task; moment: Moment; minutes: number; waitingFor: string; seq: number }> = [];
		// 只对状态命中、可能需要提醒的任务读历史，与账本总量无关。
		for (const task of moments(db, postCompact)) {
			const events = history(db, task.id);
			const activity = events.filter((event) => countsAsActivity(event.kind)).at(-1)!;
			const done = events.find((event) => event.kind === "done");
			// origin 只记录来源：自检输入一律投到任务的会话里，旧的自由文本 origin 不会被当成目标。
			const moment: Moment | undefined =
				task.state === "active"
					? "stall"
					: task.state === "waiting-user" && task.origin
						? "user-wait"
						: task.state === "done" && postCompact
							? "postCompact"
							: undefined;
			if (!moment) continue;
			// 连续失败只记一次：上一次提醒失败后没有新进展，就不再按窗口重发（BE-01）。
			const failed = events.findLast(
				(event) => event.kind === "moment-result" && event.data.moment === moment && Boolean(event.data.error),
			);
			if (failed && !events.some((event) => event.seq > failed.seq && countsAsActivity(event.kind))) continue;
			const last = events.findLast((event) => event.kind === "moment" && event.data.moment === moment);
			const since =
				moment === "postCompact"
					? done!.at
					: moment === "user-wait"
						? events.findLast((event) => event.data.state === "waiting-user")!.at
						: activity.at;
			const window = moment === "stall" ? stallMinutes : moment === "user-wait" ? userWaitMinutes : 15;
			if (moment === "postCompact" && last) continue;
			if (moment === "user-wait" && last && Date.parse(last.at) >= Date.parse(since)) continue;
			if (now - Math.max(Date.parse(since), last ? Date.parse(last.at) : 0) < window * 60000) continue;
			const seq = append(db, task.id, "moment", { moment }, now, true);
			due.push({
				task,
				moment,
				minutes: Math.floor((now - Date.parse(since)) / 60000),
				waitingFor: events.findLast((event) => event.data.note)?.data.note ?? task.objective,
				seq,
			});
		}
		db.exec("COMMIT");
		return due;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
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

/** 审计结论进账本：驳回也要落库，下一轮渲染据此注入审计员的反对意见。 */
export function recordAudit(db: DatabaseSync, id: string, result: Omit<AuditResult, "at">, now = Date.now()): void {
	append(db, id, "audit", { auditResult: { ...result, at: new Date(now).toISOString() } }, now);
}

/**
 * 结算 token 用量。`used` 是会话累计值，只增不减；用量不算进度，所以不推进 revision。
 * `warned` 记下收尾提示已注入，避免每轮重复。
 */
export function spendTokens(
	db: DatabaseSync,
	id: string,
	used: number,
	warned: boolean,
	now = Date.now(),
): Task | undefined {
	const task = find(db, id);
	if (!task) return undefined;
	const budget = { ...task.budget, used: Math.max(task.budget.used ?? 0, used) };
	if (warned) budget.warned = true;
	if (budget.used === (task.budget.used ?? 0) && Boolean(budget.warned) === Boolean(task.budget.warned)) return task;
	append(db, id, "spend", { budget }, now);
	return { ...task, budget };
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
		const block =
			mark?.revision === revision
				? line
				: `${line}\n${JSON.stringify({ ...task, wakeups: task.wakeups + Number(counted) })}`;
		// 驳回意见紧挨任务块：每次渲染都带，压缩丢了历史也还在。
		lines.push(
			task.auditResult?.verdict === "rejected" ? `${auditorRejection(task.auditResult.reason)}\n${block}` : block,
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

/** 尾部进展按 (destination, fingerprint) 判重，但只压住 TTL 内的重复：更久之后再出现是同一条进展的新提醒。 */
export const DIGEST_TTL_MS = 6 * 3600000;

export function claimDigest(
	db: DatabaseSync,
	task: Task,
	destination: string,
	now: number,
	ttl = DIGEST_TTL_MS,
): boolean {
	db.exec("BEGIN IMMEDIATE");
	try {
		const fingerprint = digestFingerprint(task);
		const last = digests(db, task.id).findLast((event) => event.data.destination === destination);
		const claimed = last?.data.fingerprint !== fingerprint || now - Date.parse(last.at) >= ttl;
		if (claimed)
			append(db, task.id, "digest", { destination, fingerprint, lastDeliveryAt: task.lastDeliveryAt }, now, true);
		db.exec("COMMIT");
		return claimed;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

export function digestSeen(
	db: DatabaseSync,
	task: Task,
	destination: string,
	now = Date.now(),
	ttl = DIGEST_TTL_MS,
): boolean {
	return digests(db, task.id).some(
		(event) =>
			event.data.destination === destination &&
			now - Date.parse(event.at) < ttl &&
			(event.data.fingerprint === digestFingerprint(task) ||
				(!["waiting-user", "review", "blocked"].includes(task.state) &&
					event.data.lastDeliveryAt === task.lastDeliveryAt)),
	);
}
