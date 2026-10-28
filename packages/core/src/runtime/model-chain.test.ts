import { describe, expect, it } from "vitest";
import {
	accountProvider,
	chainKey,
	chainRef,
	DEFAULT_MODEL_HOLD_SECONDS,
	DEFAULT_MODEL_PROBE_SECONDS,
	fallbackAliases,
	holdSeconds,
	MIN_MODEL_PROBE_SECONDS,
	modelChain,
	parseAccountProvider,
	probeSeconds,
	refKey,
	splitModelRef,
} from "./model-chain.js";

describe("model chain", () => {
	it("splits refs and alias ids", () => {
		expect(splitModelRef("openai/gpt-6.1-sol")).toEqual({ provider: "openai", modelId: "gpt-6.1-sol" });
		expect(splitModelRef("meta/llama-3")).toEqual({ provider: "meta", modelId: "llama-3" });
		expect(() => splitModelRef("openai")).toThrow();
		expect(accountProvider("openai", "gpt2")).toBe("openai#gpt2");
		expect(parseAccountProvider("openai#gpt2")).toEqual({ provider: "openai", slot: "gpt2" });
		expect(parseAccountProvider("openai")).toBeUndefined();
	});
	it("keeps the primary alone without a fallback", () => {
		const chain = modelChain("openai/gpt-6.1-sol", undefined);
		expect(chain).toEqual([
			{ provider: "openai", modelId: "gpt-6.1-sol", base: "openai", slot: "default", account: false },
		]);
	});
	it("runs the first fallback model before other accounts", () => {
		const chain = modelChain(
			"openai/gpt-6.1-sol",
			{ models: ["rightapi-glm/glm-5.3-flash"], accounts: { openai: ["gpt2", "gpt3"] } },
			{ openai: "gpt2" },
		);
		expect(chain.map(chainRef)).toEqual([
			"openai/gpt-6.1-sol",
			"rightapi-glm/glm-5.3-flash",
			"openai#gpt3/gpt-6.1-sol",
		]);
		expect(chain[0]!.slot).toBe("gpt2");
		expect(chain[2]).toMatchObject({ base: "openai", slot: "gpt3", account: true });
	});
	it.each([
		[undefined, ["openai/main", "other/one", "openai#backup/main", "other/two"]],
		["accounts-first", ["openai/main", "openai#backup/main", "other/one", "other/two"]],
		["models-first", ["openai/main", "other/one", "other/two", "openai#backup/main"]],
	] as const)("orders the chain with %s", (order, expected) => {
		const chain = modelChain("openai/main", {
			...(order ? { order } : {}),
			models: ["other/one", "other/two", "other/one"],
			accounts: { openai: ["backup", "backup"] },
		});
		expect(chain.map(chainRef)).toEqual(expected);
	});
	it("collapses entries that repeat the same model and account", () => {
		const chain = modelChain(
			"openai/gpt-6.1-sol",
			{ models: ["openai/gpt-6.1-sol", "openai/gpt-6.1-sol", "rightapi-glm/glm-5.3-flash"] },
			{},
		);
		expect(chain.map(chainRef)).toEqual(["openai/gpt-6.1-sol", "rightapi-glm/glm-5.3-flash"]);
	});
	it("substitutes a smaller model on a limited account", () => {
		const chain = modelChain(
			"openai/gpt-6.1-sol",
			{
				models: ["rightapi-glm/glm-5.3-flash"],
				accounts: { openai: ["gpt2"] },
				accountModels: { gpt2: { "openai/gpt-6.1-sol": "openai/gpt-6.1-terra" } },
			},
			{},
		);
		expect(chain.map((entry) => `${entry.provider}/${entry.modelId}`)).toEqual([
			"openai/gpt-6.1-sol",
			"rightapi-glm/glm-5.3-flash",
			"openai#gpt2/gpt-6.1-terra",
		]);
	});
	it("applies the substitution to the primary slot too and ignores cross-provider mappings", () => {
		const chain = modelChain(
			"openai/gpt-6.1-sol",
			{
				models: [],
				accountModels: { gpt2: { "openai/gpt-6.1-sol": "rightapi-glm/glm-5.3-flash" } },
			},
			{ openai: "gpt2" },
		);
		expect(chain[0]).toMatchObject({ provider: "openai", modelId: "gpt-6.1-sol", slot: "gpt2" });
	});
	it("keys health by model and account", () => {
		expect(chainKey({ provider: "openai", modelId: "m", base: "openai", slot: "default", account: false })).toBe(
			"openai/m@default",
		);
		expect(chainKey({ provider: "openai#gpt2", modelId: "m", base: "openai", slot: "gpt2", account: true })).toBe(
			"openai/m@gpt2",
		);
		expect(refKey("openai#gpt2/gpt-6.1-sol")).toBe("openai/gpt-6.1-sol@gpt2");
		expect(refKey("openai/gpt-6.1-sol", { openai: "gpt2" })).toBe("openai/gpt-6.1-sol@gpt2");
	});
	it("registers only the accounts the chain actually uses", () => {
		expect(
			fallbackAliases({ models: [], accounts: { openai: ["gpt2", "gpt3"] } }, { openai: "gpt2" }, "openai/x"),
		).toEqual({ "openai#gpt3": { provider: "openai", slot: "gpt3" } });
		expect(fallbackAliases(undefined, {}, "openai/x")).toEqual({});
	});
	it("uses documented defaults for hold and probe", () => {
		expect(holdSeconds(undefined)).toBe(DEFAULT_MODEL_HOLD_SECONDS);
		expect(holdSeconds({ models: [], hold: 60 })).toBe(60);
		expect(probeSeconds(undefined)).toBe(DEFAULT_MODEL_PROBE_SECONDS);
		expect(probeSeconds({ models: [], probe: 1 })).toBe(MIN_MODEL_PROBE_SECONDS);
	});
});
