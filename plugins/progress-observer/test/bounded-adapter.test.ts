import type { Models } from "@yonder/sdk";
import { describe, expect, it, vi } from "vitest";
import { createBoundedDecider, observerSnapshot } from "../src/bounded-adapter.js";
import { safeFallback, type Task } from "../src/ledger.js";

const task: Task = {
	id: "task",
	label: "SECRET FREE TEXT",
	executor: "active",
	accepted: "pending",
	delivery: "not_sent",
	seen: ["old-history"],
	pending: ["proof-1"],
};
function modelApi(response: string | Promise<string>) {
	const completeSimple = vi.fn(async (_model: unknown, _input: unknown, _options: unknown) => ({
		content: [{ type: "text", text: await response }],
	}));
	const models = {
		getModel: vi.fn(() => ({ provider: "chosen", id: "configured" })),
		completeSimple,
	} as unknown as Models;
	return { models, completeSimple };
}

describe("bounded model adapter", () => {
	it("sends only bounded snapshot to the configured model with no tools and capped tokens", async () => {
		const { models, completeSimple } = modelApi(
			JSON.stringify({ decision: "notify", evidence: ["proof-1"], text: "Update" }),
		);
		const result = await createBoundedDecider(models, { provider: "chosen", modelId: "configured" })(task, 10);
		expect(result.decision).toBe("notify");
		expect(models.getModel).toHaveBeenCalledWith("chosen", "configured");
		const call = completeSimple.mock.calls[0];
		expect(call).toBeDefined();
		const [, input, options] = call ?? [];
		expect(input).not.toHaveProperty("tools");
		expect(options).toMatchObject({ maxTokens: 256, signal: expect.any(AbortSignal) });
		const serialized = JSON.stringify(input);
		expect(serialized).not.toContain("SECRET FREE TEXT");
		expect(serialized).not.toContain("old-history");
		expect(observerSnapshot(task)).toEqual({
			executor: "active",
			accepted: "pending",
			delivery: "not_sent",
			pendingEvidenceIds: ["proof-1"],
		});
	});
	it.each([
		"not json",
		JSON.stringify({ decision: "ask", evidence: [], text: "ask" }),
		JSON.stringify({ decision: "notify", evidence: ["fabricated"], text: "x" }),
	])("falls back on invalid or forbidden output", async (raw) => {
		const { models } = modelApi(raw);
		expect(await createBoundedDecider(models, { provider: "chosen", modelId: "configured" })(task, 10)).toEqual(
			safeFallback(task),
		);
	});
	it("aborts timed-out generation and resolves to safe fallback", async () => {
		vi.useFakeTimers();
		try {
			let signal: AbortSignal | undefined;
			const models = {
				getModel: () => ({}),
				completeSimple: vi.fn((_m: unknown, _i: unknown, o: { signal: AbortSignal }) => {
					signal = o.signal;
					return new Promise<never>(() => {});
				}),
			} as unknown as Models;
			const pending = createBoundedDecider(models, { provider: "chosen", modelId: "configured" })(task, 10);
			await vi.advanceTimersByTimeAsync(8_000);
			expect(signal?.aborted).toBe(true);
			expect(await pending).toEqual(safeFallback(task));
		} finally {
			vi.useRealTimers();
		}
	});
});
