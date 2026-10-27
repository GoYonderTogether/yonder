import { afterEach, describe, expect, it, vi } from "vitest";
import { createDedupe, type SignalRecord } from "./dedupe.js";

afterEach(() => vi.useRealTimers());

function collector() {
	const records: SignalRecord[] = [];
	return { records, emit: (record: SignalRecord) => records.push(record) };
}

describe("dedupe", () => {
	it("首次出现立即输出完整记录", () => {
		const { records, emit } = collector();
		const dedupe = createDedupe({ emit, now: () => 1000 });
		dedupe.report({
			code: "recovery.missing-receipt",
			level: "warn",
			message: "历史提交 1 无原生回执",
			detail: { id: 1 },
		});
		expect(records).toEqual([
			{
				code: "recovery.missing-receipt",
				level: "warn",
				message: "历史提交 1 无原生回执",
				count: 1,
				firstAt: 1000,
				lastAt: 1000,
				detail: { id: 1 },
			},
		]);
		dedupe.close();
	});

	it("重复出现只累加计数与末次时间，不输出", () => {
		let clock = 1000;
		const { records, emit } = collector();
		const dedupe = createDedupe({ emit, now: () => clock });
		dedupe.report({ code: "recovery.missing-receipt", level: "warn", message: "无回执", detail: { id: 10 } });
		clock = 2000;
		dedupe.report({ code: "recovery.missing-receipt", level: "warn", message: "无回执", detail: { id: 11 } });
		clock = 3000;
		dedupe.report({ code: "recovery.missing-receipt", level: "warn", message: "无回执", detail: { id: 12 } });
		expect(records).toHaveLength(1);
		dedupe.flush();
		expect(records).toHaveLength(2);
		const summary = records[1];
		expect(summary?.count).toBe(2);
		expect(summary?.firstAt).toBe(1000);
		expect(summary?.lastAt).toBe(3000);
		// detail 保留首次现场，不被后续覆盖。
		expect(summary?.detail).toEqual({ id: 10 });
		expect(summary?.message).toContain("同类 2 次");
		dedupe.close();
	});

	it("flush 之后计数清零，没有新事件就不再输出", () => {
		const { records, emit } = collector();
		const dedupe = createDedupe({ emit, now: () => 1 });
		dedupe.report({ code: "delivery.failed", level: "error", message: "投递失败" });
		dedupe.report({ code: "delivery.failed", level: "error", message: "投递失败" });
		dedupe.flush();
		expect(records).toHaveLength(2);
		dedupe.flush();
		expect(records).toHaveLength(2);
		dedupe.report({ code: "delivery.failed", level: "error", message: "投递失败" });
		dedupe.flush();
		expect(records).toHaveLength(3);
		expect(records[2]?.count).toBe(1);
		dedupe.close();
	});

	it("不同 code 各自计数、互不合并", () => {
		const { records, emit } = collector();
		const dedupe = createDedupe({ emit, now: () => 1 });
		dedupe.report({ code: "delivery.failed", level: "error", message: "a" });
		dedupe.report({ code: "plugin.observer-failed", level: "warn", message: "b" });
		dedupe.report({ code: "delivery.failed", level: "error", message: "a" });
		dedupe.flush();
		expect(records.map((record) => [record.code, record.count])).toEqual([
			["delivery.failed", 1],
			["plugin.observer-failed", 1],
			["delivery.failed", 1],
		]);
		dedupe.close();
	});

	it("到点自动 flush", () => {
		vi.useFakeTimers();
		const { records, emit } = collector();
		const dedupe = createDedupe({ emit, flushMs: 60_000 });
		dedupe.report({ code: "channel.transport-failed", level: "warn", message: "连接断开" });
		dedupe.report({ code: "channel.transport-failed", level: "warn", message: "连接断开" });
		expect(records).toHaveLength(1);
		vi.advanceTimersByTime(59_999);
		expect(records).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(records).toHaveLength(2);
		dedupe.close();
	});

	it("close 前把窗口内计数吐出去，且之后不再接收", () => {
		const { records, emit } = collector();
		const dedupe = createDedupe({ emit, now: () => 5 });
		dedupe.report({ code: "recovery.missing-receipt", level: "warn", message: "无回执" });
		dedupe.report({ code: "recovery.missing-receipt", level: "warn", message: "无回执" });
		dedupe.close();
		expect(records).toHaveLength(2);
		dedupe.report({ code: "recovery.missing-receipt", level: "warn", message: "无回执" });
		expect(records).toHaveLength(2);
	});
});
