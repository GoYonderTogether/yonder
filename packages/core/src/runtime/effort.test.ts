import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { expect, test } from "vitest";
import { resolveEffort } from "./effort.js";

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
