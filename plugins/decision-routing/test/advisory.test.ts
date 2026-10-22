// Kept at the permitted pi import boundary; the external library imports only SDK types.
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { afterEach, expect, test, vi } from "vitest";
import {
	createDecisionProvider,
	type Policy,
	recommend,
	validateAnswer,
	validatePolicy,
} from "../dist/advisory.js";

const models = builtinModels();
const catalogModel = models.getModelsOfType("classifier", "openai")[0];
if (!catalogModel) throw new Error("Pinned catalog must include OpenAI classifier");
const model = catalogModel;
const classifier = { provider: model.provider, id: model.id };
const policy = (): Policy => ({
	routes: [{ id: "default", model: "openai/gpt-6-luna", effort: "medium", description: "Configured default" }],
	defaultRoute: "default",
	allowedModels: ["openai/gpt-6-luna"],
	allowedEfforts: ["medium"],
	allowedClassifierModels: [`${model.provider}/${model.id}`],
	allowedClassifierOrigins: [new URL(model.baseUrl).origin],
	maxInputBytes: 100,
	timeoutMs: 50,
	minConfidence: 0.7,
	budgetUsd: 1,
	routeCostBounds: { default: { usd: 0.5, expires: Date.now() + 60000 } },
	classifierCostBound: { usd: 0.1, expires: Date.now() + 60000 },
});
const request = () => ({
	summary: "",
	capabilities: ["admin", "network"] as const,
	signal: new AbortController().signal,
});
afterEach(() => vi.restoreAllMocks());

test("catalog exposes a real classifier and adapter forwards abort with zero provider retries", async () => {
	expect(model.type).toBe("classifier");
	const failure = new Error("injected dispatch failure");
	const dispatch = vi.spyOn(models, "classify").mockRejectedValue(failure);
	const context = { state: {}, questions: {} };
	const signal = new AbortController().signal;
	await expect(createDecisionProvider(models, model).decide(context, signal)).rejects.toBe(failure);
	expect(dispatch).toHaveBeenCalledExactlyOnceWith(model, context, { signal, maxRetries: 0 });
});

test("owner explicit selection precedes classifier and disclosure checks without mutating defaults", async () => {
	const p = policy();
	p.allowedClassifierModels = [];
	const before = structuredClone(p);
	const dispatch = vi.spyOn(models, "classify");
	expect(await recommend(models, classifier, p, { ...request(), ownerChoice: "default" })).toMatchObject({
		status: "selected",
		reason: "owner_choice",
		classification: "not_started",
	});
	expect(dispatch).not.toHaveBeenCalled();
	expect(p).toEqual(before);
	await expect(recommend(models, classifier, p, { ...request(), ownerChoice: "other" })).rejects.toThrow(
		"owner_choice_not_allowed",
	);
});

test.each(["allowlist", "effort", "budget", "unknown-cost", "stale-cost", "invalid-number", "default", "duplicate"])(
	"policy rejects %s",
	(kind) => {
		const p = policy();
		if (kind === "allowlist") p.allowedModels = [];
		if (kind === "effort") p.allowedEfforts = [];
		if (kind === "budget") p.budgetUsd = 0;
		if (kind === "unknown-cost") p.routeCostBounds = {};
		if (kind === "stale-cost") p.classifierCostBound.expires = 0;
		if (kind === "invalid-number") p.budgetUsd = Number.NaN;
		if (kind === "default") p.defaultRoute = "other";
		if (kind === "duplicate") p.routes = [...p.routes, ...p.routes];
		expect(() => validatePolicy(p)).toThrow();
	},
);

test("permission, privacy and UTF8 limits reject before any auth or classification", async () => {
	const available = vi.spyOn(models, "getAvailableOfType");
	await expect(recommend(models, classifier, policy(), { ...request(), capabilities: [] })).rejects.toThrow(
		"permission_denied",
	);
	await expect(recommend(models, classifier, policy(), { ...request(), summary: "鲸".repeat(34) })).rejects.toThrow(
		"input_not_allowed",
	);
	const p = policy();
	p.allowedClassifierOrigins = [];
	await expect(recommend(models, classifier, p, request())).rejects.toThrow("disclosure_not_allowed");
	expect(available).not.toHaveBeenCalled();
});

test("unavailable classifier falls back once without inference", async () => {
	vi.spyOn(models, "getAvailableOfType").mockResolvedValue([]);
	const dispatch = vi.spyOn(models, "classify");
	expect(await recommend(models, classifier, policy(), request())).toMatchObject({
		status: "fallback",
		reason: "classifier_unavailable",
		classification: "not_started",
	});
	expect(dispatch).not.toHaveBeenCalled();
});

test("dispatch error is unknown, never retried or converted to a new model submission", async () => {
	vi.spyOn(models, "getAvailableOfType").mockResolvedValue([model]);
	const dispatch = vi.spyOn(models, "classify").mockRejectedValue(new Error("injected lost outcome"));
	expect(await recommend(models, classifier, policy(), request())).toMatchObject({
		status: "unknown",
		classification: "unknown",
	});
	expect(dispatch).toHaveBeenCalledTimes(1);
	const context = dispatch.mock.calls[0]?.[1];
	if (!context) throw new Error("No dispatch context");
	expect(Object.keys(context.state)).toEqual(["summary"]);
	expect(context.images).toBeUndefined();
});

test("timeout aborts one dispatch and emits one default suggestion with unknown billing outcome", async () => {
	vi.spyOn(models, "getAvailableOfType").mockResolvedValue([model]);
	const dispatch = vi.spyOn(models, "classify").mockImplementation(() => new Promise(() => {}));
	const p = policy();
	p.timeoutMs = 5;
	expect(await recommend(models, classifier, p, request())).toMatchObject({
		status: "fallback",
		reason: "classification_timeout",
		classification: "unknown",
	});
	expect(dispatch).toHaveBeenCalledTimes(1);
	expect(dispatch.mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
});

test("cancellation before or during dispatch never returns a usable fallback route", async () => {
	vi.spyOn(models, "getAvailableOfType").mockResolvedValue([model]);
	const controller = new AbortController();
	const dispatch = vi.spyOn(models, "classify").mockImplementation(() => {
		controller.abort();
		return new Promise(() => {});
	});
	expect(await recommend(models, classifier, policy(), { ...request(), signal: controller.signal })).toMatchObject({
		status: "cancelled",
		classification: "unknown",
	});
	expect(await recommend(models, classifier, policy(), { ...request(), signal: controller.signal })).toMatchObject({
		status: "cancelled",
		classification: "not_started",
	});
	expect(dispatch).toHaveBeenCalledTimes(1);
});

test("pure answer validator rejects missing answers and invalid probabilities", () => {
	// Schema validation fixture only; not supplied as an inference response.
	const invalid = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: "stop" as const,
		timestamp: 0,
	};
	expect(validateAnswer(invalid, policy().routes, 0.7)).toBeUndefined();
	for (const probability of [Number.NaN, -1, 2, 0.5]) {
		expect(
			validateAnswer(
				{
					...invalid,
					answers: {
						route: { type: "choice", choice: "default", probabilities: { default: probability }, confidence: 0.9 },
					},
				},
				policy().routes,
				0.7,
			),
		).toBeUndefined();
	}
});

test("malformed completed classification falls back once, never recurses", async () => {
	vi.spyOn(models, "getAvailableOfType").mockResolvedValue([model]);
	// Fault injection: empty answers are deliberately NOT a model answer.
	const dispatch = vi.spyOn(models, "classify").mockResolvedValue({
		api: model.api,
		provider: model.provider,
		model: model.id,
		answers: {},
		stopReason: "stop",
		timestamp: 0,
	});
	expect(await recommend(models, classifier, policy(), request())).toMatchObject({
		status: "fallback",
		reason: "invalid_classification",
		classification: "completed",
	});
	expect(dispatch).toHaveBeenCalledTimes(1);
});

test("SDK error or abort result remains unknown without fallback submission", async () => {
	vi.spyOn(models, "getAvailableOfType").mockResolvedValue([model]);
	for (const stopReason of ["error", "aborted"] as const) {
		const dispatch = vi.spyOn(models, "classify").mockResolvedValue({
			api: model.api,
			provider: model.provider,
			model: model.id,
			answers: {},
			stopReason,
			timestamp: 0,
		});
		expect(await recommend(models, classifier, policy(), request())).toMatchObject({
			status: "unknown",
			classification: "unknown",
		});
		expect(dispatch).toHaveBeenCalledTimes(1);
		dispatch.mockRestore();
	}
});

test("timeout during availability cannot start a late inference", async () => {
	let finish!: (value: []) => void;
	vi.spyOn(models, "getAvailableOfType").mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const dispatch = vi.spyOn(models, "classify");
	const p = policy();
	p.timeoutMs = 5;
	expect(await recommend(models, classifier, p, request())).toMatchObject({
		status: "fallback",
		reason: "classification_timeout",
		classification: "not_started",
	});
	finish([]);
	await Promise.resolve();
	expect(dispatch).not.toHaveBeenCalled();
});
