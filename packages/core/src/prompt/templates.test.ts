import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { expandTemplate, pluginTemplateDirs } from "./templates.js";

test("prompt templates follow pi argument expansion and agent overrides", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-templates-"));
	try {
		await mkdir(join(home, "prompts"));
		await mkdir(join(home, "agents", "main", "prompts"), { recursive: true });
		await writeFile(join(home, "prompts", "review.md"), "home $1");
		await writeFile(
			join(home, "agents", "main", "prompts", "review.md"),
			"---\ndescription: Review\n---\n$1|$2|$@|${3:-fallback}|${@:2:1}|$ARGUMENTS",
		);
		expect(await expandTemplate(home, "main", '/review "two words" "$1"')).toBe(
			"two words|$1|two words $1|fallback|$1|two words $1",
		);
		expect(await expandTemplate(home, "other", "/review change")).toBe("home change");
		expect(await expandTemplate(home, null, "/missing hi")).toBe("/missing hi");
		expect(await expandTemplate(home, "main", "/../review")).toBe("/../review");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("plugin rescue template is discovered only when its directory is selected", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-rescue-"));
	try {
		const directory = join(process.cwd(), "plugins/codex-companion");
		const plugins = [{ id: "codex-companion", directory }];
		expect(
			pluginTemplateDirs(plugins, [
				{ name: "codex-companion_task", plugin: "codex-companion", exposure: "plugin-not-selected" },
			]),
		).toEqual([]);
		const reviewOnly = pluginTemplateDirs(plugins, [
			{ name: "codex-companion_review", plugin: "codex-companion", exposure: "offer" },
		]);
		const selected = pluginTemplateDirs(plugins, [
			{ name: "codex-companion_task", plugin: "codex-companion", exposure: "search" },
		]);
		const request = "/codex:rescue --fresh --model spark investigate failure";
		expect(await expandTemplate(home, null, request)).toBe(request);
		expect(await expandTemplate(home, null, request, reviewOnly)).toBe(request);
		const expanded = await expandTemplate(home, null, request, selected);
		expect(expanded).toContain("codex-companion_task");
		expect(expanded).toContain("--fresh --model spark investigate failure");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
