import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { expandTemplate, listTemplates, pluginTemplateDirs } from "./templates.js";

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

test("task templates use subagent then executor then home and list the same visible commands", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-task-templates-"));
	try {
		for (const path of ["agents/scout/prompts", "presets/scout/prompts", "prompts", "plugin/prompts"])
			await mkdir(join(home, path), { recursive: true });
		await mkdir(join(home, "agents/nested"));
		await writeFile(
			join(home, "agents/nested/different-filename.md"),
			"---\nname: scout\ndescription: Scout\n---\nInspect.",
		);
		await writeFile(join(home, "agents/scout/prompts/check.md"), "---\ndescription: Child\n---\nchild $1");
		await writeFile(join(home, "presets/scout/prompts/check.md"), "executor $1");
		await writeFile(join(home, "presets/scout/prompts/execute.md"), "execute $1");
		await writeFile(join(home, "prompts/check.md"), "home $1");
		await writeFile(join(home, "plugin/prompts/plugin.md"), "---\ntool: selected\ndescription: Plugin\n---\nplugin $1");
		const plugins = [{ directory: join(home, "plugin/prompts"), tools: ["selected"] }];
		expect(await expandTemplate(home, null, '/check "two words"', plugins, "scout")).toBe("child two words");
		expect(await expandTemplate(home, null, "/execute hi", plugins, "scout")).toBe("execute hi");
		await writeFile(
			join(home, "agents/scout/prompts/only-child.md"),
			"---\nname: phantom\ndescription: Not an agent\n---\nchild only",
		);
		expect(await expandTemplate(home, "main", "/execute hi", plugins, "scout")).toBe("/execute hi");
		expect(await expandTemplate(home, null, "/only-child", plugins, "other")).toBe("/only-child");
		expect(await expandTemplate(home, null, "/plugin hi", plugins, "scout")).toBe("plugin hi");
		expect(await listTemplates(home, null, "scout", plugins)).toEqual([
			{ name: "check", description: "Child" },
			{ name: "only-child", description: "Not an agent" },
			{ name: "execute", description: "" },
			{ name: "plugin", description: "Plugin" },
		]);
		expect(
			await listTemplates(home, null, "scout", [{ directory: join(home, "plugin/prompts"), tools: [] }]),
		).not.toContainEqual({ name: "plugin", description: "Plugin" });
		await rm(join(home, "agents/nested/different-filename.md"));
		expect(await expandTemplate(home, null, "/check hi", plugins, "scout")).toBe("executor hi");
		expect(await expandTemplate(home, null, "/only-child", plugins, "phantom")).toBe("/only-child");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
