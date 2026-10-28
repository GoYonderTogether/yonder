import { expect, test } from "vitest";
import { CommandAutocomplete } from "./autocomplete.js";
import { chatCommands } from "./terminal.js";

test("localized Yonder commands use native completion and keep canonical command tokens", async () => {
	const provider = new CommandAutocomplete(chatCommands, process.cwd());
	const options = { signal: new AbortController().signal };
	const zh = await provider.getSuggestions(["/继续"], 0, 3, options);
	expect(zh?.items[0]?.value).toBe("resume");
	const item = zh?.items[0];
	expect(item).toBeDefined();
	if (!item || !zh) throw new Error("Missing completion");
	expect(provider.applyCompletion(["/继续"], 0, 3, item, zh.prefix).lines).toEqual(["/resume "]);
	const en = await provider.getSuggestions(["/res"], 0, 4, options);
	expect(en?.items.some((item) => item.value === "resume")).toBe(true);
});

test("template names use native slash completion without shadowing commands", async () => {
	const provider = new CommandAutocomplete(chatCommands, process.cwd(), async () => [
		{ value: "review", label: "review", description: "Prompt template" },
		{ value: "resume", label: "resume", description: "Prompt template" },
	]);
	const suggestions = await provider.getSuggestions(["/rev"], 0, 4, { signal: new AbortController().signal });
	const item = suggestions?.items.find((entry) => entry.value === "review");
	expect(item).toBeDefined();
	if (!item || !suggestions) throw new Error("Missing template");
	expect(provider.applyCompletion(["/rev"], 0, 4, item, suggestions.prefix).lines).toEqual(["/review "]);
	const all = await provider.getSuggestions(["/"], 0, 1, { signal: new AbortController().signal });
	expect(all?.items.filter((entry) => entry.value === "resume")).toHaveLength(1);
});
