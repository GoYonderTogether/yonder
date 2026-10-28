import type { PromptInput, ToolRegistration } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { promptSections } from "./prompt-sections.js";

test("guidelines follow the offered tools, with stable order and deduplication", async () => {
	const values: Record<string, string[]> = { alpha: ["shared", "alpha"], beta: ["shared", "beta"] };
	const section = promptSections(
		{},
		() => undefined,
		(name) => values[name],
	).at(-1)!;
	const render = (names: string[]) =>
		section.render(
			{ agent: { tools: names.map((name) => ({ name })) } } as unknown as PromptInput<ToolRegistration>,
			{} as never,
		);
	expect(await render([])).toBeUndefined();
	expect(await render(["alpha"])).toBe("Tool guidelines:\n- shared\n- alpha");
	expect(await render(["beta", "alpha"])).toBe("Tool guidelines:\n- shared\n- alpha\n- beta");
	expect(await render(["alpha", "beta"])).toBe(await render(["beta", "alpha"]));
});

test("find and ls guidance is absent when neither tool is selected", async () => {
	const section = promptSections(
		{},
		() => undefined,
		(name) => (name === "find" || name === "ls" ? [`${name} guidance`] : undefined),
	).at(-1);
	expect(section).toBeDefined();
	const render = (names: string[]) =>
		section?.render(
			{ agent: { tools: names.map((name) => ({ name })) } } as unknown as PromptInput<ToolRegistration>,
			{} as never,
		);
	expect(await render(["read"])).toBeUndefined();
	expect(await render(["find"])).toBe("Tool guidelines:\n- find guidance");
	expect(await render(["ls"])).toBe("Tool guidelines:\n- ls guidance");
});
