import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	loadYonderConfig,
	matchesGlob,
	parseAgentConfig,
	parseYonderConfig,
	resolveProfile,
} from "./index.js";

describe("config basics", () => {
	it("loads default locale/timezone through the real home config loader", async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-locale-config-"));
		try {
			await writeFile(join(home, "yonder.yaml"), "schema: 1\n");
			expect(await loadYonderConfig(home)).toMatchObject({ locale: "zh-CN", timezone: "Asia/Shanghai" });
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
	it("defaults locale and timezone to Chinese and Shanghai, validates IANA values, and permits overrides", () => {
		expect(parseYonderConfig("schema: 1", "yonder.yaml")).toMatchObject({ locale: "zh-CN", timezone: "Asia/Shanghai" });
		expect(parseYonderConfig("schema: 1\nlocale: en-US\ntimezone: America/Caracas", "yonder.yaml")).toMatchObject({
			locale: "en-US",
			timezone: "America/Caracas",
		});
		for (const config of ["locale: invalid_locale", "timezone: Not/AZone"])
			expect(() => parseYonderConfig(`schema: 1\n${config}`, "yonder.yaml"), config).toThrow();
	});
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

it("prompt fields inherit independently and invalid section ids fail before publication", async () => {
	const { parsePresetConfig } = await import("./index.js");
	const defaults = { prompt: { sections: ["framework", "common.writing"], overrides: { framework: "Custom frame" } } };
	expect(resolveProfile({ prompt: { sections: [] } }, defaults).prompt).toEqual({
		sections: [],
		overrides: { framework: "Custom frame" },
	});
	expect(resolveProfile({ prompt: { overrides: {} } }, defaults).prompt).toEqual({
		sections: ["framework", "common.writing"],
		overrides: {},
	});
	expect(
		parsePresetConfig(
			'schema: 1\ndescription: Prompt configuration validation\nprompt:\n  sections: []\n  overrides: { framework: "" }\n',
			"short",
		).prompt,
	).toEqual({ sections: [], overrides: { framework: "" } });
	for (const config of [
		"prompt: { sections: [misspelled] }",
		"prompt: { overrides: { misspelled: text } }",
		"prompt: { sections: [framework, framework] }",
		"prompt: { sections: false }",
	])
		expect(() =>
			parsePresetConfig(`schema: 1\ndescription: Prompt configuration validation\n${config}\n`, "short"),
		).toThrow();
});
