import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinModels, getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { expect, test } from "vitest";
import { FileCredentials } from "./credentials.js";
import { modelProfile, modelProfiles } from "./model-profile.js";
import { buildModels } from "./models.js";

const model = getBuiltinModel("openai", "gpt-6-luna");

test("reads actual catalog costs and capabilities without inventing scores or speed", () => {
	const profile = modelProfile(model);
	expect(profile.id).toBe(`${model.provider}/${model.id}`);
	expect(profile.cost).toMatchObject(model.cost);
	expect(profile.catalog.contextWindow).toBe(model.contextWindow);
	expect(profile.catalog.input).toEqual(model.input);
	expect(profile.scores.intelligence.overall).toBeNull();
	expect(profile.local.p50Ms).toBeNull();
	expect(profile.tags).toEqual([]);
	expect(profile.notes).toBe("");
	expect(profile.catalog.toolCall).toBeNull();
});

test("partial catalog entries keep missing numbers null and collections empty", () => {
	const profile = modelProfile({ id: model.id, provider: model.provider });
	expect(profile.cost).toEqual({
		unit: "usd_per_mtok",
		input: null,
		output: null,
		cacheRead: null,
		cacheWrite: null,
		tiers: [],
	});
	expect(profile.catalog).toMatchObject({ contextWindow: null, maxOutput: null, input: [], reasoning: { levels: [] } });
	expect(profile.pins).toEqual({ prefer: [], avoid: [] });
});

test("projects every real builtin chat entry without hard-coded model choices", () => {
	for (const entry of builtinModels().getModels()) {
		if (entry.type && entry.type !== "chat") continue;
		expect(modelProfile(entry).id).toBe(`${entry.provider}/${entry.id}`);
	}
});

test("provider declarations use the existing merged catalog and credential availability", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-model-profile-"));
	try {
		const models = buildModels(new FileCredentials(join(home, "auth.json")), {
			[model.provider]: { modelOverrides: { [model.id]: { contextWindow: model.contextWindow - 1 } } },
		});
		const configured = models.getModel(model.provider, model.id);
		if (!configured) throw new Error("Real catalog model missing");
		expect(modelProfile(configured).catalog.contextWindow).toBe(model.contextWindow - 1);
		const profiles = await modelProfiles(models);
		const available = await models.getAvailable();
		expect(profiles.map((profile) => profile.id)).toEqual(available.map((entry) => `${entry.provider}/${entry.id}`));
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("SiliconFlow V3.2 uses its documented thinking fields while explicit settings win", () => {
	const provider = {
		api: "openai-completions",
		baseUrl: "https://api.siliconflow.cn/v1",
		models: [{ id: "deepseek-ai/DeepSeek-V3.2" }],
	};
	const credentials = new FileCredentials(join(tmpdir(), "unused-yonder-auth.json"));
	const configured = buildModels(credentials, { siliconflow: provider }).getModel(
		"siliconflow",
		provider.models[0]!.id,
	);
	expect(configured).toMatchObject({
		reasoning: true,
		compat: {
			thinkingFormat: "qwen",
			supportsReasoningEffort: false,
			supportsDeveloperRole: false,
			thinkingTokenBudgetField: "thinking_budget",
		},
	});
	const explicit = buildModels(credentials, {
		siliconflow: { ...provider, models: [{ ...provider.models[0], reasoning: false }] },
	}).getModel("siliconflow", provider.models[0]!.id);
	expect(explicit?.reasoning).toBe(false);
});
