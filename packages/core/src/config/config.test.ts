import { describe, expect, it } from "vitest";
import { matchesGlob, parseAgentConfig, parseYonderConfig, resolveProfile } from "./index.js";

describe("config basics", () => {
	it("reads retry options from YAML and rejects invalid retry parameters", () => {
		expect(
			parseYonderConfig("schema: 1\nretry: { maxRetries: 0, baseDelayMs: 25, maxDelayMs: 100 }", "yonder.yaml").retry,
		).toEqual({ maxRetries: 0, baseDelayMs: 25, maxDelayMs: 100 });
		for (const retry of [
			"maxRetries: -1",
			"maxRetries: 1.5",
			"baseDelayMs: 0",
			"maxDelayMs: 0",
			"maxDelayMs: 2147483648",
			"unknown: 1",
		])
			expect(() => parseYonderConfig(`schema: 1\nretry: { ${retry} }`, "yonder.yaml"), retry).toThrow();
	});
	it("validates an agent and resolves profile overrides", () => {
		const agent = parseAgentConfig(
			`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: guest
defaults:
  contexts: [one, two]
  tools: { offer: [read], search: [find] }
  limits: { maxTurns: 10, maxMinutes: 5 }
profiles:
  guest:
    contexts: [one]
    tools: { offer: [custom] }
    limits: { maxTurns: 20 }
bindings: []
`,
			"agents/main/agent.yaml",
			"main",
		);
		const profile = resolveProfile(agent.profiles.guest!, agent.defaults, "local");
		expect(profile.contexts).toEqual(["one"]);
		expect(profile.tools).toEqual({ offer: ["custom"], search: ["find"] });
		expect(profile.limits).toEqual({ maxTurns: 20, maxMinutes: 5, maxTokens: 200000, repeatBlock: 3, repeatStop: 5 });
		expect(matchesGlob("tool_?ead*", "tool_read_file")).toBe(true);
	});
});

it("accepts only cloud HTTPS avatar URLs while keeping old Agent config compatible", () => {
	const config = {
		schema: 1,
		id: "main",
		name: "Main",
		owner: "person:owner",
		defaultProfile: "default",
		profiles: { default: {} },
		bindings: [],
	};
	expect(parseAgentConfig(JSON.stringify(config)).avatarUrl).toBeUndefined();
	expect(parseAgentConfig(JSON.stringify({ ...config, avatarUrl: "https://cdn.yonder.cn/bot.png" })).avatarUrl).toBe(
		"https://cdn.yonder.cn/bot.png",
	);
	for (const avatarUrl of [
		"file:///tmp/avatar.png",
		"data:image/png;base64,x",
		"blob:https://cdn.yonder.cn/a",
		"/tmp/a.png",
		"http://cdn.yonder.cn/a",
		"https://localhost/a",
		"https://127.0.0.1/a",
		"https://10.1.2.3/a",
		"https://[::1]/a",
		"https://router.local/a",
		"https://a:secret@cdn.yonder.cn/a",
	])
		expect(() => parseAgentConfig(JSON.stringify({ ...config, avatarUrl })), avatarUrl).toThrow(/avatarUrl/);
});
