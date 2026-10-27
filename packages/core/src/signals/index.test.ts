import { describe, expect, it } from "vitest";
import type { SignalRecord } from "./dedupe.js";
import { createSignals } from "./index.js";

function collector() {
	const records: SignalRecord[] = [];
	return { records, emit: (record: SignalRecord) => records.push(record) };
}

describe("createSignals", () => {
	it("按 code 分级，而不是按调用方的说法", () => {
		const { records, emit } = collector();
		const signals = createSignals({ emit, now: () => 1 });
		signals.report("recovery.missing-receipt", new Error("历史提交 10 无原生回执"));
		signals.report("delivery.failed", new Error("投递失败"));
		signals.report("unknown", new Error("没见过的错"));
		expect(records.map((record) => [record.code, record.level])).toEqual([
			["recovery.missing-receipt", "warn"],
			["delivery.failed", "error"],
			["unknown", "warn"],
		]);
		signals.close();
	});

	it("同 code 首次全量、之后只计数，flush 输出汇总", () => {
		const { records, emit } = collector();
		const signals = createSignals({ emit, now: () => 7, flushMs: 60_000 });
		for (let index = 0; index < 11726; index += 1) {
			signals.report("recovery.missing-receipt", new Error(`历史提交 ${index} 无原生回执`), { id: index });
		}
		expect(records).toHaveLength(1);
		expect(records[0]?.count).toBe(1);
		expect(records[0]?.detail).toEqual({ id: 0 });
		signals.flush();
		expect(records).toHaveLength(2);
		expect(records[1]?.count).toBe(11725);
		expect(records[1]?.message).toContain("累计 11726 次");
		signals.close();
	});

	it("非 Error 的 throw 值也能变成可读消息", () => {
		const { records, emit } = collector();
		const signals = createSignals({ emit, now: () => 1 });
		signals.report("plugin.observer-failed", "观察者返回 false");
		signals.report("plugin.observer-failed", { reason: "boom" });
		expect(records[0]?.message).toBe("观察者返回 false");
		signals.close();
	});

	it("close 之后静默，不再输出", () => {
		const { records, emit } = collector();
		const signals = createSignals({ emit, now: () => 1 });
		signals.close();
		signals.report("delivery.failed", new Error("投递失败"));
		signals.flush();
		expect(records).toHaveLength(0);
	});
});
