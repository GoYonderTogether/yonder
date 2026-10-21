import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { requestedEffort, resolveEffort } from "./effort.js";

const model = getBuiltinModel("openai", "gpt-6-luna");

test("absent override uses the model-normalized default without override authority", () => {
	expect(resolveEffort(model, "medium")).toEqual({ effective: clampThinkingLevel(model, "medium") });
});

test.each(["high", "not-a-level", "", "HIGH"])("denies %j before validating or falling back", (request) => {
	expect(() => resolveEffort(model, "medium", request)).toThrow("not authorized");
	expect(() => resolveEffort(model, "medium", request, false)).toThrow("not authorized");
});

test.each(["not-a-level", "", "HIGH", " high "])(
	"invalid authorized %j falls back to configured default",
	(request) => {
		expect(resolveEffort(model, "medium", request, true)).toEqual({
			requested: request,
			effective: clampThinkingLevel(model, "medium"),
			fallbackReason: "invalid-level",
		});
	},
);

test("authorized supported overrides retain requested/effective without mutating model metadata", () => {
	const before = structuredClone(model);
	for (const level of getSupportedThinkingLevels(model))
		expect(resolveEffort(model, "medium", level, true)).toEqual({ requested: level, effective: level });
	expect(model).toEqual(before);
	expect(resolveEffort(model, "medium").effective).toBe(clampThinkingLevel(model, "medium"));
});

test("actual catalog unsupported levels use pi's deterministic adjacent support, not string distance", () => {
	const models = builtinModels().getModels();
	let unsupported = 0;
	for (const candidate of models) {
		const available = getSupportedThinkingLevels(candidate);
		if (!available.length) continue;
		for (const requested of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
			const resolution = resolveEffort(candidate, "medium", requested, true);
			expect(available).toContain(resolution.effective);
			expect(resolution.effective).toBe(clampThinkingLevel(candidate, requested));
			if (!available.includes(requested)) {
				unsupported++;
				expect(resolution.fallbackReason).toBe("unsupported-level");
			}
		}
	}
	expect(unsupported).toBeGreaterThan(0);
});

test("a real non-reasoning catalog model resolves default and override to off with distinct reasons", () => {
	const candidate = builtinModels()
		.getModels()
		.find((entry) => !entry.reasoning);
	expect(candidate).toBeDefined();
	if (!candidate) return;
	expect(resolveEffort(candidate, "medium")).toEqual({ effective: "off", fallbackReason: "unsupported-default" });
	expect(resolveEffort(candidate, "medium", "high", true)).toEqual({
		requested: "high",
		effective: "off",
		fallbackReason: "unsupported-level",
	});
	expect(resolveEffort(candidate, "medium", "invalid", true)).toEqual({
		requested: "invalid",
		effective: "off",
		fallbackReason: "invalid-level",
	});
});

const event = (
	type: string,
	from: string | undefined,
	conv: string | undefined,
	data: Record<string, unknown>,
	id: string,
): YEvent => ({ id, ts: "2026-10-21T00:00:00.000Z", type, from, conv, data }) as YEvent;
const asked = (id: string, effort: unknown, extra: Record<string, unknown> = {}) =>
	event("message.in", "acct:agent:main", "conv:agent:main", { kind: "agent", text: "x", effort, ...extra }, id);

test("only kernel-written delegations can request an effort", () => {
	expect(requestedEffort([asked("a", "high")])).toEqual({ requested: "high", inputs: ["a"] });
	const task = event(
		"session.input",
		"agent:main",
		undefined,
		{ session: "9", text: "t", taskOwned: true, effort: "low" },
		"t",
	);
	expect(requestedEffort([task])).toEqual({ requested: "low", inputs: ["t"] });
	// Channel and plugin events, or unowned task inputs, never carry this authority.
	expect(
		requestedEffort([event("message.in", "acct:feishu:ou_1", "conv:feishu:oc_1", { text: "x", effort: "max" }, "c")]),
	).toBeUndefined();
	expect(
		requestedEffort([event("message.in", "acct:feishu:ou_1", "conv:agent:forged", { text: "x", effort: "max" }, "p")]),
	).toBeUndefined();
	expect(
		requestedEffort([event("session.input", "plugin:evil", undefined, { taskOwned: true, effort: "max" }, "s")]),
	).toBeUndefined();
	expect(requestedEffort([event("session.input", "agent:main", undefined, { effort: "max" }, "u")])).toBeUndefined();
	expect(requestedEffort([asked("n", undefined), asked("o", 3)])).toBeUndefined();
});

test("inputs merged into one run resolve to the highest valid request; invalid-only passes through", () => {
	expect(requestedEffort([asked("a", "low"), asked("b", "high"), asked("c", "medium")])).toEqual({
		requested: "high",
		inputs: ["a", "b", "c"],
	});
	expect(requestedEffort([asked("a", "bogus"), asked("b", "low")])).toEqual({ requested: "low", inputs: ["a", "b"] });
	expect(requestedEffort([asked("a", "bogus"), asked("b", "nope")])).toEqual({
		requested: "bogus",
		inputs: ["a", "b"],
	});
});
