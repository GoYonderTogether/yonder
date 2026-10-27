import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { type CompactionDb, compactBackgroundOutcomes } from "./derived.js";

type Param = null | number | bigint | string | Uint8Array;

const DAY_MS = 86_400_000;
const NOW = 1_700_000_000_000;
const HEAD_CHARS = Math.floor(2048 / 3);

interface TaskRow {
	id: number;
	record: string;
}

/** 与内核 Db 同形状的内存实现，跑真实 SQL（过滤条件由语句本身决定）。 */
function memoryDb(): { db: CompactionDb; raw: DatabaseSync } {
	const raw = new DatabaseSync(":memory:");
	raw.exec(`
		CREATE TABLE pi_tasks (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, record TEXT NOT NULL);
		CREATE TABLE pi_entries (id INTEGER PRIMARY KEY, record TEXT NOT NULL);
		CREATE TABLE y_events (id TEXT PRIMARY KEY, type TEXT NOT NULL);
	`);
	const db: CompactionDb = {
		async all<T extends object>(sql: string, ...params: Param[]) {
			return raw.prepare(sql).all(...params) as T[];
		},
		async run(sql: string, ...params: Param[]) {
			raw.prepare(sql).run(...params);
		},
	};
	return { db, raw };
}

function taskRecord(options: { text: string; endedAt?: number; status?: string }): string {
	return JSON.stringify({
		id: 1,
		conversationId: 7,
		kind: "yonder.background",
		background: true,
		startedAt: NOW - 3 * DAY_MS,
		...(options.endedAt === undefined ? {} : { endedAt: options.endedAt }),
		state: {
			status: options.status ?? "terminal",
			outcome: { status: "success", text: options.text },
		},
	});
}

function insertTask(raw: DatabaseSync, id: number, kind: string, status: string, record: string): void {
	raw
		.prepare("INSERT INTO pi_tasks (id, kind, status, record) VALUES (?, ?, ?, ?)")
		.run(id, JSON.stringify(kind), status, record);
}

function taskRows(raw: DatabaseSync): Map<number, string> {
	const rows = raw.prepare("SELECT id, record FROM pi_tasks ORDER BY id").all() as unknown as TaskRow[];
	return new Map(rows.map((row) => [row.id, row.record]));
}

describe("派生物正文回收", () => {
	it("只处理 kind、status、保留期与大小都命中的记录", async () => {
		const { db, raw } = memoryDb();
		const big = "x".repeat(6000);
		insertTask(raw, 1, "yonder.background", "terminal", taskRecord({ text: big, endedAt: NOW - 2 * DAY_MS }));
		insertTask(raw, 2, "yonder.background", "terminal", taskRecord({ text: big, endedAt: NOW - 60 * 60_000 }));
		insertTask(
			raw,
			3,
			"yonder.background",
			"running",
			taskRecord({ text: big, status: "running", endedAt: NOW - 2 * DAY_MS }),
		);
		insertTask(raw, 4, "yonder.task", "terminal", taskRecord({ text: big, endedAt: NOW - 2 * DAY_MS }));
		insertTask(raw, 5, "yonder.background", "terminal", taskRecord({ text: "small", endedAt: NOW - 2 * DAY_MS }));
		insertTask(raw, 6, "yonder.background", "terminal", taskRecord({ text: big }));
		// 数据库里 kind 是带引号的 JSON 字符串；不带引号的值不该命中。
		raw
			.prepare("INSERT INTO pi_tasks (id, kind, status, record) VALUES (?, ?, ?, ?)")
			.run(7, "yonder.background", "terminal", taskRecord({ text: big, endedAt: NOW - 2 * DAY_MS }));
		raw
			.prepare("INSERT INTO pi_entries (id, record) VALUES (?, ?)")
			.run(1, JSON.stringify({ text: "transcript copy" }));
		raw.prepare("INSERT INTO y_events (id, type) VALUES (?, ?)").run("e1", "session.input");
		const before = taskRows(raw);

		const summary = await compactBackgroundOutcomes(db, {
			olderThanDays: 1,
			budgetBytes: 50 * 1024 * 1024,
			now: NOW,
		});

		expect(summary.compacted).toBe(1);
		expect(summary.skipped).toBe(0);
		expect(summary.bytesReclaimed).toBe(summary.bytesBefore - summary.bytesAfter);
		expect(summary.bytesReclaimed).toBeGreaterThan(0);

		const after = taskRows(raw);
		expect(after.size).toBe(before.size);
		for (const id of [2, 3, 4, 5, 6, 7]) expect(after.get(id)).toBe(before.get(id));

		const record = JSON.parse(after.get(1) ?? "") as Record<string, unknown>;
		const state = record.state as Record<string, unknown>;
		expect(state.status).toBe("terminal");
		const outcome = state.outcome as Record<string, unknown>;
		expect(outcome.status).toBe("success");
		expect(outcome.text).toBeUndefined();
		const compacted = outcome.compacted as Record<string, unknown>;
		const source = JSON.stringify({ status: "success", text: big });
		expect(compacted.bytes).toBe(Buffer.byteLength(source, "utf8"));
		expect(compacted.sha256).toBe(createHash("sha256").update(source).digest("hex"));
		expect(compacted.head).toBe(source.slice(0, HEAD_CHARS));
		expect(compacted.tail).toBe(source.slice(-HEAD_CHARS));

		expect(raw.prepare("SELECT COUNT(*) AS n FROM pi_entries").get()).toEqual({ n: 1 });
		const entries = raw.prepare("SELECT record FROM pi_entries").all() as unknown as Array<{ record: string }>;
		expect(entries).toEqual([{ record: JSON.stringify({ text: "transcript copy" }) }]);
		expect(raw.prepare("SELECT id, type FROM y_events").all()).toEqual([{ id: "e1", type: "session.input" }]);
	});

	it("apply=false 只统计不写库", async () => {
		const { db, raw } = memoryDb();
		insertTask(
			raw,
			1,
			"yonder.background",
			"terminal",
			taskRecord({ text: "y".repeat(6000), endedAt: NOW - 2 * DAY_MS }),
		);
		const before = taskRows(raw);

		const summary = await compactBackgroundOutcomes(db, {
			olderThanDays: 1,
			budgetBytes: 50 * 1024 * 1024,
			now: NOW,
			apply: false,
		});

		expect(summary.compacted).toBe(1);
		expect(summary.bytesReclaimed).toBeGreaterThan(0);
		expect(taskRows(raw)).toEqual(before);
	});

	it("用途预算与 limit 限制单轮处理量", async () => {
		const { db, raw } = memoryDb();
		for (const [id, size] of [
			[1, 7000],
			[2, 8000],
			[3, 9000],
		] as const) {
			insertTask(
				raw,
				id,
				"yonder.background",
				"terminal",
				taskRecord({ text: "z".repeat(size), endedAt: NOW - 2 * DAY_MS }),
			);
		}

		const summary = await compactBackgroundOutcomes(db, {
			olderThanDays: 1,
			budgetBytes: 1,
			now: NOW,
		});

		expect(summary.compacted).toBe(1);
		expect(summary.skipped).toBe(2);
		const compactedRows = [...taskRows(raw).values()].filter((record) => record.includes('"compacted"'));
		expect(compactedRows).toHaveLength(1);

		const limited = memoryDb();
		for (const [id, size] of [
			[1, 7000],
			[2, 8000],
		] as const) {
			insertTask(
				limited.raw,
				id,
				"yonder.background",
				"terminal",
				taskRecord({ text: "z".repeat(size), endedAt: NOW - 2 * DAY_MS }),
			);
		}
		const first = await compactBackgroundOutcomes(limited.db, {
			olderThanDays: 1,
			budgetBytes: 50 * 1024 * 1024,
			now: NOW,
			limit: 1,
		});
		expect(first.compacted).toBe(1);
		const untouched = [...taskRows(limited.raw).values()].filter((record) => !record.includes('"compacted"'));
		expect(untouched).toHaveLength(1);
	});
});
