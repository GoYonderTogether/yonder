import type { DatabaseSync } from "node:sqlite";
import type { RenderContext, ToolContext } from "@yonder/sdk";
import {
	changeTask,
	changeTasks,
	claimDigest,
	claimMoments,
	digestSeen,
	momentResult,
	openTask,
	renderTurn,
} from "./append.js";
import type { Moment, Open, Task, TaskEvent, Update, UpdateItem } from "./project.js";
import { all, find, get, history, list, progress } from "./query.js";
import { connect, needsBackfill, rebuild as replayInto } from "./schema.js";

export type { Moment, Open, State, Task, TaskContent, TaskEvent, Update, UpdateItem } from "./project.js";

export class Store {
	// 常驻连接：每次读都重开数据库要付打开、chmod、建表三份代价。
	// 多个 Store 实例各持一条连接，写仍由 SQLite 串行化；close() 后下次调用自动重开。
	#db: DatabaseSync | undefined;
	constructor(private readonly data: string) {}

	get #handle(): DatabaseSync {
		if (!this.#db) {
			const db = connect(this.data);
			// 升级到投影表的第一件事：账本里有事件、投影为空，就一次性回填。
			if (needsBackfill(db)) replayInto(db);
			this.#db = db;
		}
		return this.#db;
	}

	close(): void {
		this.#db?.close();
		this.#db = undefined;
	}

	rebuild(): number {
		return replayInto(this.#handle);
	}

	open(args: Open, ctx: ToolContext): Task {
		return openTask(this.#handle, args, ctx);
	}
	update(id: string, args: Update, ctx: ToolContext): Task {
		return changeTask(this.#handle, id, args, ctx);
	}
	/** 一批更新共用一个事务：任一条被拒就整批回滚。 */
	updateMany(items: UpdateItem[], ctx: ToolContext): Task[] {
		return changeTasks(this.#handle, items, ctx);
	}
	done(id: string, deliverable: string, evidence: string[], ctx: ToolContext): Task {
		return changeTask(this.#handle, id, { state: "done", deliverable, evidence }, ctx);
	}
	list(ctx: ToolContext): Task[] {
		return list(this.#handle, ctx);
	}
	forSession(session: string) {
		return all(this.#handle).filter(({ task }) => task.session === session);
	}
	get(id: string, ctx: ToolContext): { task: Task; history: TaskEvent[] } {
		return get(this.#handle, id, ctx);
	}
	progress(tasks: Task[]): Map<string, string | null> {
		return progress(this.#handle, tasks);
	}
	claimMoments(now: number, stallMinutes: number, userWaitMinutes: number, postCompact: boolean) {
		return claimMoments(this.#handle, now, stallMinutes, userWaitMinutes, postCompact);
	}
	/** stall 投递前的二次校验：读 claim 之后的任务与历史，不走按调用方过滤的 get。 */
	taskById(id: string): { task: Task; history: TaskEvent[] } | undefined {
		const task = find(this.#handle, id);
		return task ? { task, history: history(this.#handle, task.id) } : undefined;
	}
	momentResult(id: string, moment: Moment, data: { result?: unknown; error?: string }, now: number): void {
		momentResult(this.#handle, id, moment, data, now);
	}
	recentlyDone(task: Task, now = Date.now()): boolean {
		return task.state === "done" && now - Date.parse(task.lastActivityAt) < 30 * 60000;
	}
	render(ctx: RenderContext): string | undefined {
		return renderTurn(this.#handle, ctx);
	}
	claimDigest(task: Task, destination: string, now: number): boolean {
		return claimDigest(this.#handle, task, destination, now);
	}
	digestSeen(task: Task, destination: string, now = Date.now()): boolean {
		return digestSeen(this.#handle, task, destination, now);
	}
}
