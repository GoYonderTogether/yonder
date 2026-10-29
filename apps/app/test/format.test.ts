import { describe, expect, it } from "vitest";
import { childrenLine, contextLine, footerSegments, lspLine, modelLine, tokens, usageLine } from "../src/work/lib/format";

const totals = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
	input,
	output,
	cacheRead,
	cacheWrite,
	cost: 0,
});

describe("tokens", () => {
	it("matches the pi footer scale", () => {
		expect(tokens(0)).toBe("0");
		expect(tokens(999)).toBe("999");
		expect(tokens(6800)).toBe("6.8k");
		expect(tokens(123_000)).toBe("123k");
		expect(tokens(901_000)).toBe("901k");
		expect(tokens(2_800_000)).toBe("2.8M");
		expect(tokens(15_000_000)).toBe("15M");
	});
});

describe("usageLine", () => {
	it("shows ↑ ↓ R W CH from the real snapshot", () => {
		expect(usageLine(totals(6800, 123_000, 15_000_000, 901_000), 98.6)).toBe("↑6.8k ↓123k R15M W901k CH98.6%");
	});

	it("omits zero and missing categories instead of padding them", () => {
		expect(usageLine(totals(0, 123))).toBe("↓123");
		expect(usageLine(totals(0, 0))).toBeUndefined();
		expect(usageLine(undefined)).toBeUndefined();
	});

	it("shows CH only with cache traffic and a real cacheHitPct", () => {
		// 没有 last.cacheHitPct：不按 totals 反推
		expect(usageLine(totals(10, 20, 100, 5))).toBe("↑10 ↓20 R100 W5");
		// 没有缓存流量：即使给了百分比也不显示
		expect(usageLine(totals(10, 20), 50)).toBe("↑10 ↓20");
	});
});

describe("childrenLine", () => {
	it("labels the children scope", () => {
		expect(childrenLine(totals(2_800_000, 577_000))).toBe("sub-agents ↑2.8M ↓577k");
	});

	it("omits when there is no child usage", () => {
		expect(childrenLine(undefined)).toBeUndefined();
		expect(childrenLine(totals(0, 0))).toBeUndefined();
	});
});

describe("contextLine", () => {
	it("shows percent/window with the auto marker", () => {
		expect(contextLine({ tokens: 121_000, window: 200_000, percent: 60.5, auto: true })).toBe("60.5%/200k (auto)");
		expect(contextLine({ tokens: 121_000, window: 200_000, percent: 60.5, auto: false })).toBe("60.5%/200k");
	});

	it("falls back to the known window when occupancy is missing", () => {
		expect(contextLine(undefined, 400_000)).toBe("?/400k");
		expect(contextLine(undefined, undefined)).toBeUndefined();
	});
});

describe("lspLine and modelLine", () => {
	it("renders LSP only when a producer reported it", () => {
		expect(lspLine({ name: "typescript", state: "Active" })).toBe("LSP Active: typescript");
		expect(lspLine(undefined)).toBeUndefined();
	});

	it("renders provider, routed model and thinking", () => {
		expect(modelLine({ provider: "rightapi-claude", model: "claude-opus-5-5", thinking: "high" })).toBe(
			"(rightapi-claude) claude-opus-5-5 • high",
		);
		expect(
			modelLine({
				provider: "openai",
				model: "virtual",
				routedTo: { provider: "openai", model: "gpt-6-luna" },
			}),
		).toBe("(openai) virtual → gpt-6-luna");
		expect(modelLine(undefined)).toBeUndefined();
	});
});

describe("footerSegments", () => {
	it("keeps only the fields that are present", () => {
		expect(footerSegments({})).toEqual({});
		expect(
			footerSegments({
				usage: totals(10, 20),
				cacheHitPct: 50,
				children: totals(1, 2),
				context: { tokens: 1, window: 200_000, percent: 60.5, auto: true },
				model: { provider: "openai", model: "gpt-6-luna" },
			}),
		).toEqual({
			usage: "↑10 ↓20",
			children: "sub-agents ↑1 ↓2",
			context: "60.5%/200k (auto)",
			model: "(openai) gpt-6-luna",
		});
	});

	it("does not invent LSP or CH when the data is absent", () => {
		const seg = footerSegments({ usage: totals(10, 20, 100), contextWindow: 200_000 });
		expect(seg).toEqual({ usage: "↑10 ↓20 R100", context: "?/200k" });
	});
});
