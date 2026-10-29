import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parseAgentConfig, parseYonderConfig, tokenAmount } from "./index.js";
import { socialDefaults } from "./social-schema.js";

const agent = {
	schema: 1,
	id: "a",
	name: "A",
	owner: "person:o",
	defaultProfile: "main",
	profiles: { main: {} },
	bindings: [],
};

test("a minimal yonder.yaml resolves the O51 defaults (IMP-02)", () => {
	const config = parseYonderConfig("schema: 1\n", "yonder.yaml");
	expect(config.models).toEqual({ chain: ["workbuddy", "rightapi-glm/glm-5.3-flash"], priceCapPerMTokenYuan: 0.6 });
	expect(config.budget).toEqual({ tokens: 0, overBudget: "record" });
	expect(config.outsiders).toEqual({
		ownerShareDailyTokens: 500000,
		perPersonDailyTokens: 3000000,
		requireLoginForQuota: true,
		guestMaxRounds: 3,
		capabilities: ["chat", "web_search", "public_docs"],
		publicDocs: [],
	});
	expect(config.defaults).toEqual({ channelPolicy: "open" });
});

test("the shipped node yonder.yaml loads and keeps its providers next to the defaults", async () => {
	const text = (await readFile(new URL("../../../../deploy/node/yonder.yaml", import.meta.url), "utf8")).replace(
		"__YONDER_PUBLIC_ORIGIN__",
		"https://node.example.org",
	);
	const config = parseYonderConfig(text, "deploy/node/yonder.yaml");
	expect(Object.keys(config.models?.providers ?? {})).toEqual(["rightapi-glm", "workbuddy"]);
	expect(config.models?.chain).toEqual(["workbuddy", "rightapi-glm/glm-5.3-flash"]);
	expect(config.budget?.overBudget).toBe("record");
});

test("explicit values override defaults and token amounts accept K/M units", () => {
	const config = parseYonderConfig(
		JSON.stringify({
			schema: 1,
			models: { chain: ["workbuddy"], priceCapPerMTokenYuan: 0.3 },
			budget: { tokens: 1000, maxMinutes: 20, maxWakeups: 5, overBudget: "stop" },
			outsiders: { ownerShareDailyTokens: "2M", guestMaxRounds: 0 },
			defaults: { channelPolicy: "closed" },
		}),
		"yonder.yaml",
	);
	expect(config.models).toEqual({ chain: ["workbuddy"], priceCapPerMTokenYuan: 0.3 });
	expect(config.budget).toEqual({ tokens: 1000, maxMinutes: 20, maxWakeups: 5, overBudget: "stop" });
	expect(config.outsiders?.ownerShareDailyTokens).toBe("2M");
	expect(config.outsiders?.perPersonDailyTokens).toBe(3000000);
	expect(config.defaults?.channelPolicy).toBe("closed");
	expect([tokenAmount("2M"), tokenAmount("500K"), tokenAmount("1.5M"), tokenAmount(0)]).toEqual([
		2000000, 500000, 1500000, 0,
	]);
	for (const bad of [
		{ outsiders: { ownerShareDailyTokens: "2G" } },
		{ outsiders: { capabilities: ["exec"] } },
		{ budget: { overBudget: "ignore" } },
		{ models: { priceCapPerMTokenYuan: -1 } },
		{ defaults: { channelPolicy: "allow" } },
	])
		expect(
			() => parseYonderConfig(JSON.stringify({ schema: 1, ...bad }), "yonder.yaml"),
			JSON.stringify(bad),
		).toThrow();
});

test("social listen, tags, judge, snapshot and botGate defaults fill a configured social block", () => {
	expect(parseAgentConfig(JSON.stringify(agent)).social).toBeUndefined();
	const social = parseAgentConfig(JSON.stringify({ ...agent, social: { enabled: true } })).social;
	expect(social).toEqual({ enabled: true, ...socialDefaults });
	expect(social?.listen).toEqual({
		mode: "realtime",
		realtime: { quietSec: 15, maxWindowSec: 120 },
		batch: { windowSec: 300, keyRules: ["owner", "link", "image"] },
		digest: { windowMin: 15, minMessages: 5 },
		mention: { strong: true },
	});
	expect(social?.judge).toEqual({ model: "cheap" });
	expect(social?.snapshot).toEqual({ enabled: true });
	expect(social?.botGate).toEqual({ windowMin: 15, threshold: 3, history: 3 });
	const custom = parseAgentConfig(
		JSON.stringify({
			...agent,
			social: {
				listen: { mode: "digest", digest: { windowMin: 30 } },
				tags: { value: "high" },
				conversations: { "conv:qq:1": { tags: { value: "low", rhythm: "high" } } },
			},
		}),
	).social;
	expect(custom?.listen?.mode).toBe("digest");
	expect(custom?.listen?.digest).toEqual({ windowMin: 30, minMessages: 5 });
	expect(custom?.tags).toEqual({ value: "high", rhythm: "normal" });
	expect(custom?.conversations?.["conv:qq:1"]?.tags).toEqual({ value: "low", rhythm: "high" });
	for (const bad of [
		{ listen: { mode: "stream" } },
		{ listen: { digest: { windowMin: 20 } } },
		{ tags: { value: "top" } },
		{ botGate: { threshold: 0 } },
	])
		expect(() => parseAgentConfig(JSON.stringify({ ...agent, social: bad })), JSON.stringify(bad)).toThrow();
});
