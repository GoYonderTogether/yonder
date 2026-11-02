import type { PromptInput, ToolRegistration } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { promptSections } from "./prompt-sections.js";

test("model facts follow each native request and distinguish configured, fallback and unknown selections", async () => {
	const configuredModel = "openai/gpt-6-luna";
	const sections = promptSections({}, () => ({
		agent: "main",
		profile: "owner",
		cwd: process.cwd(),
		resolved: resolveProfile({ model: configuredModel }),
	}));
	const section = sections.find((entry) => entry.key === "yonder-runtime-model");
	if (!section) throw new Error("Runtime model facts section is missing");
	expect(sections.indexOf(section)).toBeGreaterThan(sections.findIndex((entry) => entry.key === "yonder"));
	const render = (model?: { provider: string; modelId: string }) =>
		section.render(
			{ conversationId: 1, agent: { model, thinkingLevel: "medium" } } as unknown as PromptInput<ToolRegistration>,
			{} as never,
		);
	const primary = await render({ provider: "openai", modelId: "gpt-6-luna" });
	expect(primary).toContain(`"configuredModel":"${configuredModel}"`);
	expect(primary).toContain(`"requestModel":"${configuredModel}"`);
	const fallback = await render({ provider: "workbuddy", modelId: "deepseek-v4.1-flash" });
	expect(fallback).toContain(`"configuredModel":"${configuredModel}"`);
	expect(fallback).toContain('"requestModel":"workbuddy/deepseek-v4.1-flash"');
	expect(fallback).toContain('"thinking":"medium"');
	expect(fallback).toContain("not a provider-verified response identity");
	expect(await render({ provider: "openai#backup", modelId: "gpt-6-luna" })).not.toContain("#backup");
	expect(await render()).toContain('"requestModel":null');
	expect(await render({ provider: "openai", modelId: "gpt-6-luna" })).toBe(primary);
});
