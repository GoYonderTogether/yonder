import { describe, expect, it } from "vitest";
import { matchesGlob, parseAgentConfig, resolveProfile } from "./index.js";

describe("config basics", () => {
	it("validates an agent and resolves profile overrides", () => {
		const agent = parseAgentConfig(`schema: 1
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
`, "agents/main/agent.yaml", "main");
		const profile = resolveProfile(agent.profiles.guest!, agent.defaults, "local");
		expect(profile.contexts).toEqual(["one"]);
		expect(profile.tools).toEqual({ offer: ["custom"], search: ["find"] });
		expect(profile.limits).toEqual({ maxTurns: 20, maxMinutes: 5, repeatBlock: 3, repeatStop: 5 });
		expect(matchesGlob("tool_?ead*", "tool_read_file")).toBe(true);
	});
});
