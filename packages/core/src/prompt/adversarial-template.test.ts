import { expect, test } from "vitest";
import { expandTemplate, pluginTemplateDirs } from "./templates.js";

test("adversarial template preserves raw arguments and requires plugin selection", async () => {
	const command = '/codex:adversarial-review --wait --scope working-tree "focus  here"';
	const plugins = [{ id: "codex-companion", directory: `${process.cwd()}/plugins/codex-companion` }];
	const selected = (name: string, exposure: string) =>
		pluginTemplateDirs(plugins, [{ name, plugin: "codex-companion", exposure }]);
	expect(await expandTemplate("/nonexistent", null, command)).toBe(command);
	expect(await expandTemplate("/nonexistent", null, command, selected("codex-companion_task", "offer"))).toBe(command);
	expect(
		await expandTemplate("/nonexistent", null, command, selected("codex-companion_review", "plugin-not-selected")),
	).toBe(command);
	const expanded = await expandTemplate("/nonexistent", null, command, selected("codex-companion_review", "search"));
	expect(expanded).toContain('Original arguments: --wait --scope working-tree "focus  here"');
	expect(expanded).toContain("adversarial=true");
});
