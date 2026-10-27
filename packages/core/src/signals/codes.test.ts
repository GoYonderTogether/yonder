import { describe, expect, it } from "vitest";
import { isSignalCode, levelOf, type SignalCode } from "./codes.js";

describe("levelOf", () => {
	it("把预期内状态降到 warn，把真实故障留在 error", () => {
		expect(levelOf("recovery.missing-receipt")).toBe("warn");
		expect(levelOf("recovery.settled-failed")).toBe("error");
		expect(levelOf("channel.transport-failed")).toBe("warn");
		expect(levelOf("channel.config-invalid")).toBe("error");
		expect(levelOf("plugin.observer-failed")).toBe("warn");
		expect(levelOf("delivery.failed")).toBe("error");
		// 未知不能默认 error：这正是历史噪声的来源。
		expect(levelOf("unknown")).toBe("warn");
	});

	it("没有 info 级别的码时也不会退化成 error", () => {
		const codes: SignalCode[] = [
			"recovery.missing-receipt",
			"recovery.settled-failed",
			"channel.transport-failed",
			"channel.config-invalid",
			"plugin.observer-failed",
			"delivery.failed",
			"unknown",
		];
		for (const code of codes) expect(["error", "warn"]).toContain(levelOf(code));
	});

	it("运行时收到表外的码按 warn 处理", () => {
		expect(levelOf("plugin.not-a-real-code" as SignalCode)).toBe("warn");
	});
});

describe("isSignalCode", () => {
	it("只认已知码", () => {
		expect(isSignalCode("delivery.failed")).toBe(true);
		expect(isSignalCode("unknown")).toBe(true);
		expect(isSignalCode("delivery.unknown")).toBe(false);
		expect(isSignalCode("toString")).toBe(false);
	});
});
