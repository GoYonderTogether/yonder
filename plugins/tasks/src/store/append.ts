import { randomUUID } from "node:crypto";
import { parseRef, type RenderContext, type ToolContext } from "@yonder/sdk";
import { TURN_ONE_LINE } from "../prompts.js";
import { auditorRejection } from "../views.js";
import { applyLedgerEvent, type TaskLedger } from "./ledger.js";
import {
	type AuditResult,
	countsAsActivity,
	type Moment,
	type Open,
	ongoing,
	own,
	type Task,
	type TaskEvent,
	transitions,
} from "./project.js";
import { all, count, digests, find, history, moments, rendered } from "./query.js";

const minutes = (since: string, now: number) => `${Math.floor((now - Date.parse(since)) / 60000)}m`;

/** 追加真实事件，并通过同一 reducer 更新当前投影。 */
export function append(
	events: TaskLedger,
	task: string,
	kind: TaskEvent["kind"],
	data: TaskEvent["data"],
	now = Date.now(),
): number {
	const at = new Date(now).toISOString();
	const seq = events.nextSeq++;
	const event = { seq, task, kind, at, data } as TaskEvent;
	applyLedgerEvent(events, event);
	return seq;
}

/** 任务树最深两层：根任务之下还能挂一层子任务。 */
export const MAX_DEPTH = 2;

/** 新任务挂在 `parent` 下时的祖先数：父任务自身算一层，再往上数。 */
function depthUnder(events: TaskLedger, parent: Task): number {
	let depth = 1;
	let cursor = parent;
	while (cursor.parent) {
		const next = find(events, cursor.parent);
		if (!next) break;
		depth += 1;
		cursor = next;
	}
	return depth;
}

/** 父任务必须存在、不能落在自己子树里（成环）、且不能超过 MAX_DEPTH。 */
function checkParent(events: TaskLedger, parentId: string, task?: Task): Task {
	const parent = find(events, parentId);
	if (!parent) throw new Error("Parent task not found");
	if (task) {
		let cursor: Task | undefined = parent;
		while (cursor) {
			if (cursor.id === task.id) throw new Error("A task cannot be nested under itself");
			cursor = cursor.parent ? find(events, cursor.parent) : undefined;
		}
	}
	if (depthUnder(events, parent) > MAX_DEPTH) throw new Error(`Task nesting is limited to ${MAX_DEPTH} levels`);
	return parent;
}

/** 同一阻塞要连续报三次才允许标 blocked：投递、用量和审计事件不算一轮报告。 */
export const BLOCKER_ROUNDS = 3;

const quiet = (kind: TaskEvent["kind"]) =>
	kind === "wake" || kind === "spend" || kind === "audit" || kind === "digest" || kind.startsWith("moment");

const normalizeBlocker = (note: string) => note.replace(/\s+/gu, " ").trim().toLowerCase();

/** 从最近一条报告往回数：同一个阻塞连着报了几轮，遇到别的进展就停。 */
function blockerRounds(events: TaskLedger, id: string, note: string): number {
	const wanted = normalizeBlocker(note);
	let rounds = 0;
	for (const event of history(events, id).reverse()) {
		if (quiet(event.kind)) continue;
		if (event.kind !== "update" || !event.data.note || normalizeBlocker(event.data.note) !== wanted) break;
		rounds += 1;
	}
	return rounds;
}

export function openTask(events: TaskLedger, args: Open, ctx: ToolContext): Task {
	const parent = args.parent ? checkParent(events, args.parent) : undefined;
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
		ref: `T${count(events) + 1}`,
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
	append(events, task.id, "open", task);
	return task;
}

/** 一条 patch 的全部校验与落地；批量更新在同一条事务里复用它。 */
function change(events: TaskLedger, id: string, patch: Partial<Task> & { note?: string }, ctx: ToolContext): Task {
	const task = find(events, id);
	if (!task || !own(task, ctx)) throw new Error("Task not found for caller");
	if (!ongoing(task)) throw new Error("Task is closed");
	if (patch.state && patch.state !== task.state && !transitions[task.state].includes(patch.state))
		throw new Error(`Invalid task transition: ${task.state} -> ${patch.state}`);
	if (patch.state === "blocked" && patch.state !== task.state) {
		const note = patch.note?.trim();
		if (!note) throw new Error("Blocking a task requires a note saying what blocks it");
		const rounds = blockerRounds(events, task.id, note) + 1;
		if (rounds < BLOCKER_ROUNDS)
			throw new Error(
				`Blocking needs the same blocker reported on ${BLOCKER_ROUNDS} consecutive updates; this is report ${rounds} of ${BLOCKER_ROUNDS}. Keep the task active, report the blocker again with tasks_update next turn, and mark it blocked on report ${BLOCKER_ROUNDS}.`,
			);
	}
	if (patch.parent !== undefined && patch.parent !== null && patch.parent !== task.parent)
		patch.parent = checkParent(events, patch.parent, task).id;
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
	append(events, task.id, patch.state === "done" ? "done" : "update", patch);
	const { note: _, ...fields } = patch;
	return { ...task, ...fields };
}

export function changeTask(
	events: TaskLedger,
	id: string,
	patch: Partial<Task> & { note?: string },
	ctx: ToolContext,
): Task {
	return change(events, id, patch, ctx);
}

/** 一批更新要么全部落地、要么一条都不留：任一条不合法就回滚整批。 */
export function changeTasks(
	events: TaskLedger,
	updates: ReadonlyArray<{ id: string } & Partial<Task> & { note?: string }>,
	ctx: ToolContext,
): Task[] {
	if (!updates.length) throw new Error("updates requires at least one entry");
	return updates.map(({ id, ...patch }) => change(events, id, patch, ctx));
}

export function claimMoments(
	events: TaskLedger,
	now: number,
	stallMinutes: number,
	userWaitMinutes: number,
	postCompact: boolean,
) {
	const due: Array<{ task: Task; moment: Moment; minutes: number; waitingFor: string; seq: number }> = [];
	// 只对状态命中、可能需要提醒的任务读历史，与账本总量无关。
	for (const task of moments(events, postCompact)) {
		const taskEvents = history(events, task.id);
		const activity = taskEvents.filter((event) => countsAsActivity(event.kind)).at(-1)!;
		const done = taskEvents.find((event) => event.kind === "done");
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
		const failed = taskEvents.findLast(
			(event) => event.kind === "moment-result" && event.data.moment === moment && Boolean(event.data.error),
		);
		if (failed && !taskEvents.some((event) => event.seq > failed.seq && countsAsActivity(event.kind))) continue;
		const last = taskEvents.findLast((event) => event.kind === "moment" && event.data.moment === moment);
		const since =
			moment === "postCompact"
				? done!.at
				: moment === "user-wait"
					? taskEvents.findLast((event) => event.data.state === "waiting-user")!.at
					: activity.at;
		const window = moment === "stall" ? stallMinutes : moment === "user-wait" ? userWaitMinutes : 15;
		if (moment === "postCompact" && last) continue;
		if (moment === "user-wait" && last && Date.parse(last.at) >= Date.parse(since)) continue;
		if (now - Math.max(Date.parse(since), last ? Date.parse(last.at) : 0) < window * 60000) continue;
		const seq = append(events, task.id, "moment", { moment }, now);
		due.push({
			task,
			moment,
			minutes: Math.floor((now - Date.parse(since)) / 60000),
			waitingFor: taskEvents.findLast((event) => event.data.note)?.data.note ?? task.objective,
			seq,
		});
	}
	return due;
}

export function momentResult(
	events: TaskLedger,
	id: string,
	moment: Moment,
	data: { result?: unknown; error?: string },
	now: number,
): void {
	append(events, id, "moment-result", { moment, ...data }, now);
}

/** 审计结论进账本：驳回也要落库，下一轮渲染据此注入审计员的反对意见。 */
export function recordAudit(events: TaskLedger, id: string, result: Omit<AuditResult, "at">, now = Date.now()): void {
	append(events, id, "audit", { auditResult: { ...result, at: new Date(now).toISOString() } }, now);
}

/**
 * 结算 token 用量。`used` 是会话累计值，只增不减；用量不算进度，所以不推进 revision。
 * `warned` 记下收尾提示已注入，避免每轮重复。
 */
export function spendTokens(
	events: TaskLedger,
	id: string,
	used: number,
	warned: boolean,
	now = Date.now(),
): Task | undefined {
	const task = find(events, id);
	if (!task) return undefined;
	const budget = { ...task.budget, used: Math.max(task.budget.used ?? 0, used) };
	if (warned) budget.warned = true;
	if (budget.used === (task.budget.used ?? 0) && Boolean(budget.warned) === Boolean(task.budget.warned)) return task;
	append(events, id, "spend", { budget }, now);
	return { ...task, budget };
}

export function renderTurn(events: TaskLedger, ctx: RenderContext): string | undefined {
	ctx.signal?.throwIfAborted();
	const now = Date.now();
	const mine = (task: Task) => own(task, { agent: ctx.agent || null, session: ctx.session }) && ongoing(task);
	const tasks = all(events).filter(({ task }) => mine(task));
	const marks = rendered(
		events,
		tasks.map(({ task }) => task.id),
		ctx.session,
	);
	const lines: string[] = [];
	for (const { task, revision } of tasks) {
		const mark = marks.get(task.id);
		const counted = !ctx.event || mark?.event !== ctx.event.id;
		const line = TURN_ONE_LINE(
			task.ref,
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
			append(events, task.id, "wake", {
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
	events: TaskLedger,
	task: Task,
	destination: string,
	now: number,
	ttl = DIGEST_TTL_MS,
): boolean {
	const fingerprint = digestFingerprint(task);
	const last = digests(events, task.id).findLast((event) => event.data.destination === destination);
	const claimed = last?.data.fingerprint !== fingerprint || now - Date.parse(last.at) >= ttl;
	if (claimed)
		append(events, task.id, "digest", { destination, fingerprint, lastDeliveryAt: task.lastDeliveryAt }, now);
	return claimed;
}

export function digestSeen(
	events: TaskLedger,
	task: Task,
	destination: string,
	now = Date.now(),
	ttl = DIGEST_TTL_MS,
): boolean {
	return digests(events, task.id).some(
		(event) =>
			event.data.destination === destination &&
			now - Date.parse(event.at) < ttl &&
			(event.data.fingerprint === digestFingerprint(task) ||
				(!["waiting-user", "review", "blocked"].includes(task.state) &&
					event.data.lastDeliveryAt === task.lastDeliveryAt)),
	);
}
