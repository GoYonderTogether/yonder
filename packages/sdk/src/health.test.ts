import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChannelHealthState, createChannelHealth } from "./health.js";

afterEach(() => vi.useRealTimers());

describe("createChannelHealth", () => {
	it("初始为 healthy 且不排重试", () => {
		const health = createChannelHealth();
		expect(health.state()).toMatchObject({ status: "healthy", failures: 0, nextRetryMs: 0 });
		expect(health.nextDelay()).toBe(0);
	});

	it("按失败次数依次进入 degraded / backoff / failed", () => {
		const health = createChannelHealth();
		expect(health.fail("boom").status).toBe("degraded");
		expect(health.fail("boom").status).toBe("backoff");
		expect(health.fail("boom").status).toBe("backoff");
		expect(health.fail("boom").status).toBe("backoff");
		expect(health.fail("boom").status).toBe("failed");
		expect(health.state().failures).toBe(5);
		expect(health.state().lastError).toBe("boom");
	});

	it("onChange 只在 status 变化时触发", () => {
		const seen: ChannelHealthState[] = [];
		const health = createChannelHealth({ onChange: (state) => seen.push(state) });
		health.fail("e1");
		health.fail("e2");
		health.fail("e3");
		health.fail("e4");
		health.fail("e5");
		// failed 期间继续失败只加计数，不再通知。
		health.fail("e6");
		health.fail("e7");
		expect(seen.map((state) => state.status)).toEqual(["degraded", "backoff", "failed"]);
		expect(health.state().failures).toBe(7);
	});

	it("一次成功从任意状态回到 healthy，且再触发一次 onChange", () => {
		const seen: string[] = [];
		const health = createChannelHealth({ onChange: (state) => seen.push(state.status) });
		health.fail("boom");
		health.fail("boom");
		health.fail("boom");
		health.fail("boom");
		health.fail("boom");
		health.ok();
		expect(health.state()).toMatchObject({ status: "healthy", failures: 0, nextRetryMs: 0 });
		expect(health.state().lastError).toBeUndefined();
		expect(seen).toEqual(["degraded", "backoff", "failed", "healthy"]);
		// 已经在 healthy 时再成功不重复通知。
		health.ok();
		expect(seen).toEqual(["degraded", "backoff", "failed", "healthy"]);
	});

	it("退避按 1s、2s、4s…增长并在 maxRetryMs 封顶", () => {
		const health = createChannelHealth({ maxRetryMs: 8_000 });
		const delays: number[] = [];
		for (let index = 0; index < 6; index += 1) {
			health.fail("boom");
			delays.push(health.nextDelay());
		}
		expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
	});

	it("默认上限是 300s", () => {
		const health = createChannelHealth();
		for (let index = 0; index < 12; index += 1) health.fail("boom");
		expect(health.nextDelay()).toBe(300_000);
	});

	it("可调阈值：degradedAfter 之前保持 healthy", () => {
		const seen: string[] = [];
		const health = createChannelHealth({ degradedAfter: 3, onChange: (state) => seen.push(state.status) });
		health.fail("a");
		health.fail("b");
		expect(health.state().status).toBe("healthy");
		health.fail("c");
		expect(health.state().status).toBe("degraded");
		expect(seen).toEqual(["degraded"]);
	});

	it("reset 清零失败计数并回到 healthy", () => {
		const health = createChannelHealth();
		health.fail(new Error("boom"));
		health.fail(new Error("boom"));
		health.reset();
		expect(health.state()).toMatchObject({ status: "healthy", failures: 0, nextRetryMs: 0 });
		expect(health.state().lastError).toBeUndefined();
	});

	it("状态快照带 since，状态变化时更新", () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const health = createChannelHealth();
		expect(health.state().since).toBe(1_000);
		vi.setSystemTime(5_000);
		health.fail("boom"); // degraded
		expect(health.state().since).toBe(5_000);
		vi.setSystemTime(6_000);
		health.fail("boom"); // backoff
		expect(health.state().since).toBe(6_000);
		vi.setSystemTime(9_000);
		// 同状态内失败不改 since。
		health.fail("boom");
		expect(health.state().since).toBe(6_000);
	});
});
