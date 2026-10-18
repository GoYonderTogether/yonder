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
