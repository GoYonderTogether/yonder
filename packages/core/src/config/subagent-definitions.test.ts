import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadPresets } from "./index.js";

test("loads pi agent definitions and ignores resident agent workspace files", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-agents-"));
	try {
		await mkdir(join(home, "agents/nested"), { recursive: true });
		await mkdir(join(home, "agents/main/skills/example"), { recursive: true });
		await mkdir(join(home, "presets"));
		await writeFile(join(home, "presets/scout.yaml"), "schema: 1\ndescription: Old preset\n");
		await writeFile(join(home, "agents/main/agent.yaml"), "schema: 1\n");
		await writeFile(
			join(home, "agents/main/skills/example/SKILL.md"),
			"---\nname: wrong\ndescription: skill\n---\ntext",
		);
		await writeFile(
			join(home, "agents/nested/scout.md"),
			"---\nname: scout\ndescription: Recon\nmodel: vendor/model\ntools: read, grep\n---\nInspect files.\n",
		);
		await writeFile(join(home, "agents/nested/ignored.chain.md"), "---\nname: ignored\ndescription: chain\n---\n");
		const pluginPreset = { id: "scout", description: "Plugin preset" };
		const presets = new Map([[pluginPreset.id, pluginPreset], ...(await loadPresets(home))]);
		expect([...presets]).toEqual([
			[
				"scout",
				{
					id: "scout",
					description: "Recon",
					model: "vendor/model",
					tools: { offer: ["read", "grep"] },
					instructions: "Inspect files.",
				},
			],
		]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
