import type { PluginFiles, RenderContext, ToolContext } from "@yonder/sdk";
import {
	changeTask,
	changeTasks,
	claimDigest,
	claimMoments,
	digestSeen,
	momentResult,
	openTask,
	recordAudit,
	renderTurn,
	spendTokens,
} from "./append.js";
import {
	createTaskLedger,
	projectionDocument,
	projectionFrom,
	readAllHistory,
	readHistory,
	readProjection,
	storedProjection,
	writeHistory,
	writeProjection,
} from "./ledger.js";
import type {
	AuditResult,
	Moment,
	Open,
	Projected,
	Task,
	TaskEvent,
	TaskExecutionMetadata,
	Update,
	UpdateItem,
} from "./project.js";
import { replay } from "./project.js";
import { all, get, history, list, moments, progress } from "./query.js";

export type {
	AuditResult,
	Moment,
	Open,
	State,
	Task,
	TaskContent,
	TaskEvent,
	TaskExecutionMetadata,
	Update,
	UpdateItem,
} from "./project.js";

function historiesByTask(events: TaskEvent[]): Map<string, TaskEvent[]> {
	const histories = new Map<string, TaskEvent[]>();
	for (const event of events) {
		const history = histories.get(event.task) ?? [];
		history.push(event);
		histories.set(event.task, history);
	}
	return histories;
}

export class Store {
	#ready: Promise<void> | undefined;
	constructor(private readonly files: PluginFiles) {}
	#ensureReady(): Promise<void> {
		if (!this.#ready) this.#ready = this.importLegacy();
		return this.#ready;
	}

	async #initialize<T>(
		change: (ledger: ReturnType<typeof createTaskLedger>) => T,
		taskIds: string[] | ((ledger: ReturnType<typeof createTaskLedger>) => string[]) = [],
	): Promise<T> {
		await this.#ensureReady();
		return this.files.transaction(async (files) => {
			const projection = await readProjection(files);
			const ledger = createTaskLedger(projection);
			const ids = typeof taskIds === "function" ? taskIds(ledger) : taskIds;
			for (const id of ids) {
				const entry = storedProjection(ledger, id);
				if (!entry) continue;
				const key = entry.task.id;
				if (ledger.loadedHistories.has(key)) continue;
				ledger.histories.set(key, await readHistory(files, key));
				ledger.loadedHistories.add(key);
			}
			const result = change(ledger);
			if (ledger.appended.length) {
				for (const [id, events] of historiesByTask(ledger.appended)) {
					const fullHistory = ledger.loadedHistories.has(id)
						? (ledger.histories.get(id) ?? [])
						: [...(await readHistory(files, id)), ...events];
					await writeHistory(files, id, fullHistory);
				}
				await writeProjection(files, projectionDocument(ledger, projection.legacyImported));
			}
			return result;
		});
	}

	async #projection() {
		await this.#ensureReady();
		return createTaskLedger(await readProjection(this.files));
	}

	async importLegacy(): Promise<void> {
		const localRoot = this.files.localRoot;
		await this.files.transaction(async (files) => {
			const projection = await readProjection(files);
			const hasProjection = Object.keys(projection.tasks).length > 0;
			if (hasProjection && projection.legacyImported) return;
			if (!hasProjection && (await files.list("history")).some(({ type }) => type === "file")) {
				const events = await readAllHistory(files);
				if (events.length) {
					await writeProjection(files, projectionFrom(events, true));
					return;
				}
			}
			if (!projection.legacyImported && localRoot) {
				const { readLegacyEvents } = await import("./legacy.js");
				const imported = readLegacyEvents(localRoot);
				if (imported) {
					if (hasProjection)
						throw new Error("Both tasks projection and legacy SQLite history exist; refusing to choose one");
					const events = [...imported];
					replay(events);
					for (const [id, history] of historiesByTask(events)) await writeHistory(files, id, history);
					await writeProjection(files, projectionFrom(events, true));
					return;
				}
			}
			if (hasProjection) return;
		});
	}

	async close(): Promise<void> {
		await this.#ready;
	}

	async rebuild(): Promise<number> {
		await this.#ensureReady();
		return this.files.transaction(async (files) => {
			const events = await readAllHistory(files);
			const projection = projectionFrom(events, (await readProjection(files)).legacyImported);
			await writeProjection(files, projection);
			return replay(events).size;
		});
	}

	open(args: Open, ctx: ToolContext, metadata?: TaskExecutionMetadata): Promise<Task> {
		return this.#initialize((ledger) => openTask(ledger, args, ctx, metadata));
	}
	update(id: string, patch: Update, ctx: ToolContext, metadata?: TaskExecutionMetadata): Promise<Task> {
		return this.#initialize((ledger) => changeTask(ledger, id, patch, ctx, metadata), [id]);
	}
	updateMany(items: UpdateItem[], ctx: ToolContext, metadata?: TaskExecutionMetadata): Promise<Task[]> {
		return this.#initialize(
			(ledger) => changeTasks(ledger, items, ctx, metadata),
			items.map(({ id }) => id),
		);
	}
	done(id: string, deliverable: string, evidence: string[], ctx: ToolContext): Promise<Task> {
		return this.#initialize((ledger) => changeTask(ledger, id, { state: "done", deliverable, evidence }, ctx), [id]);
	}
	async list(ctx: ToolContext): Promise<Task[]> {
		return list(await this.#projection(), ctx);
	}
	async forSession(session: string): Promise<Projected[]> {
		return all(await this.#projection()).filter(({ task }) => task.session === session);
	}
	async get(id: string, ctx: ToolContext): Promise<{ task: Task; history: TaskEvent[] }> {
		await this.#ensureReady();
		return this.files.transaction(async (files) => {
			const ledger = createTaskLedger(await readProjection(files));
			const entry = storedProjection(ledger, id);
			if (entry) {
				ledger.histories.set(entry.task.id, await readHistory(files, entry.task.id));
				ledger.loadedHistories.add(entry.task.id);
			}
			return get(ledger, id, ctx);
		});
	}
	async progress(tasks: Task[]): Promise<Map<string, string | null>> {
		return progress(await this.#projection(), tasks);
	}
	claimMoments(now: number, stallMinutes: number, userWaitMinutes: number, postCompact: boolean) {
		return this.#initialize(
			(ledger) => claimMoments(ledger, now, stallMinutes, userWaitMinutes, postCompact),
			(ledger) => moments(ledger, postCompact).map(({ id }) => id),
		);
	}
	/** stall投递前二次校验：只读对应任务投影与历史。 */
	async taskById(id: string): Promise<{ task: Task; history: TaskEvent[] } | undefined> {
		await this.#ensureReady();
		return this.files.transaction(async (files) => {
			const ledger = createTaskLedger(await readProjection(files));
			const entry = storedProjection(ledger, id);
			if (!entry) return undefined;
			ledger.histories.set(entry.task.id, await readHistory(files, entry.task.id));
			ledger.loadedHistories.add(entry.task.id);
			return { task: entry.task, history: history(ledger, entry.task.id) };
		});
	}
	momentResult(id: string, moment: Moment, data: { result?: unknown; error?: string }, now: number): Promise<void> {
		return this.#initialize((ledger) => momentResult(ledger, id, moment, data, now), [id]);
	}
	recordAudit(id: string, result: Omit<AuditResult, "at">, now = Date.now()): Promise<void> {
		return this.#initialize((ledger) => recordAudit(ledger, id, result, now), [id]);
	}
	spend(id: string, used: number, warned: boolean, now = Date.now()): Promise<Task | undefined> {
		return this.#initialize((ledger) => spendTokens(ledger, id, used, warned, now), [id]);
	}
	recentlyDone(task: Task, now = Date.now()): boolean {
		return task.state === "done" && now - Date.parse(task.lastActivityAt) < 30 * 60000;
	}
	render(ctx: RenderContext): Promise<string | undefined> {
		return this.#initialize((ledger) => renderTurn(ledger, ctx));
	}
	claimDigest(task: Task, destination: string, now: number): Promise<boolean> {
		return this.#initialize((ledger) => claimDigest(ledger, task, destination, now), [task.id]);
	}
	digestSeen(task: Task, destination: string, now = Date.now()): Promise<boolean> {
		return this.#initialize((ledger) => digestSeen(ledger, task, destination, now), [task.id]);
	}
}
