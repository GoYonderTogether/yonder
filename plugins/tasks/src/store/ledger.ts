import type { PluginFiles } from "@yonder/sdk";
import { applyEvent, type Projected, replay, type TaskEvent } from "./project.js";

export interface StoredProjection extends Projected {
	sequence: number;
	progressAll: string | null;
	progressSinceState: string | null;
	rendered: Record<string, { revision: number; event?: string }>;
}
export interface Projection {
	version: 1;
	nextSeq: number;
	legacyImported?: true;
	tasks: Record<string, StoredProjection>;
}
export interface TaskLedger {
	projects: Map<string, StoredProjection>;
	histories: Map<string, TaskEvent[]>;
	loadedHistories: Set<string>;
	appended: TaskEvent[];
	nextSeq: number;
}

const PROJECTION = "projection.json";
const historyPath = (task: string) => `history/${encodeURIComponent(task)}.json`;

export async function readProjection(files: PluginFiles): Promise<Projection> {
	const text = await files.read(PROJECTION);
	if (text === undefined) return { version: 1, nextSeq: 1, tasks: {} };
	const value: unknown = JSON.parse(text);
	if (!value || typeof value !== "object" || (value as Projection).version !== 1 || !(value as Projection).tasks)
		throw new Error("Invalid tasks projection");
	const projection = value as Projection;
	if (Number.isSafeInteger(projection.nextSeq) && projection.nextSeq > 0) return projection;
	let nextSeq = 1;
	for (const entry of Object.values(projection.tasks)) nextSeq = Math.max(nextSeq, entry.sequence + 1);
	return { ...projection, nextSeq };
}

export const writeProjection = (files: PluginFiles, projection: Projection) =>
	files.write(PROJECTION, JSON.stringify(projection));

export async function readHistory(files: PluginFiles, task: string): Promise<TaskEvent[]> {
	const text = await files.read(historyPath(task));
	if (text === undefined) return [];
	const value: unknown = JSON.parse(text);
	if (!Array.isArray(value)) throw new Error(`Invalid history for task ${task}`);
	return value as TaskEvent[];
}

export const writeHistory = (files: PluginFiles, task: string, events: TaskEvent[]) =>
	files.write(historyPath(task), JSON.stringify(events));

export async function readAllHistory(files: PluginFiles): Promise<TaskEvent[]> {
	const entries = await files.list("history");
	const histories = await Promise.all(
		entries
			.filter(({ type, name }) => type === "file" && name.endsWith(".json"))
			.map(({ name }) => readHistory(files, decodeURIComponent(name.slice(0, -5)))),
	);
	return histories.flat().sort((a, b) => a.seq - b.seq);
}

export function projectionFrom(events: TaskEvent[], legacyImported?: true): Projection {
	const projects = replay(events);
	const tasks: Projection["tasks"] = {};
	for (const [id, projected] of projects) {
		const history = events.filter((event) => event.task === id);
		let progressAll: string | null = null;
		let progressSinceState: string | null = null;
		const rendered: StoredProjection["rendered"] = {};
		for (const event of history) {
			const progress = event.data.note?.trim() || event.data.deliverable?.trim() || null;
			if (event.data.state !== undefined) progressSinceState = progress;
			else if (progress !== null) progressSinceState = progress;
			if (progress !== null) progressAll = progress;
			if (event.kind === "wake" && event.data.renderedSession)
				rendered[event.data.renderedSession] = {
					revision: Number(event.data.renderedRevision),
					...(event.data.renderedEvent ? { event: event.data.renderedEvent } : {}),
				};
		}
		tasks[id] = {
			...projected,
			sequence: history.at(-1)?.seq ?? projected.revision,
			progressAll,
			progressSinceState,
			rendered,
		};
	}
	const nextSeq = events.reduce((next, event) => Math.max(next, event.seq + 1), 1);
	return { version: 1, nextSeq, ...(legacyImported ? { legacyImported } : {}), tasks };
}

export function createTaskLedger(projection: Projection, histories = new Map<string, TaskEvent[]>()): TaskLedger {
	const projects = new Map(Object.entries(projection.tasks));
	return {
		projects,
		histories,
		loadedHistories: new Set(histories.keys()),
		appended: [],
		nextSeq: projection.nextSeq,
	};
}

export function applyLedgerEvent(ledger: TaskLedger, event: TaskEvent): void {
	const previous = ledger.projects.get(event.task);
	const next = previous ? { task: structuredClone(previous.task), revision: previous.revision } : undefined;
	const map = new Map<string, Projected>();
	if (next) map.set(event.task, next);
	applyEvent(map, event);
	const current = map.get(event.task);
	const history = ledger.histories.get(event.task) ?? [];
	history.push(event);
	ledger.histories.set(event.task, history);
	ledger.appended.push(event);
	ledger.nextSeq = Math.max(ledger.nextSeq, event.seq + 1);
	if (!current) return;
	const progress = event.data.note?.trim() || event.data.deliverable?.trim() || null;
	const rendered = previous?.rendered ?? {};
	if (event.kind === "wake" && event.data.renderedSession)
		rendered[event.data.renderedSession] = {
			revision: Number(event.data.renderedRevision),
			...(event.data.renderedEvent ? { event: event.data.renderedEvent } : {}),
		};
	ledger.projects.set(event.task, {
		...current,
		sequence: Math.max(previous?.sequence ?? 0, event.seq),
		progressAll: event.kind === "open" ? null : (progress ?? previous?.progressAll ?? null),
		progressSinceState:
			event.kind === "open" || event.data.state !== undefined
				? progress
				: (progress ?? previous?.progressSinceState ?? null),
		rendered,
	});
}

export function storedProjection(ledger: TaskLedger, idOrRef: string): StoredProjection | undefined {
	return ledger.projects.get(idOrRef) ?? [...ledger.projects.values()].find(({ task }) => task.ref === idOrRef);
}

export function projectionDocument(ledger: TaskLedger, legacyImported?: true): Projection {
	return {
		version: 1,
		nextSeq: ledger.nextSeq,
		...(legacyImported ? { legacyImported } : {}),
		tasks: Object.fromEntries(ledger.projects),
	};
}
