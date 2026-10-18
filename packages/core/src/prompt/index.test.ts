import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { localEnvironment, workspaceFiles } from "../runtime/env.js";
import { framework, type PromptOptions, scaffoldWorkspace, systemSections } from "./index.js";

test("system sections are deterministic and only selected contexts render", async () => {
	const directory = await mkdtemp(join(tmpdir(), "yonder-prompt-"));
	try {
		const files = workspaceFiles(localEnvironment(directory));
		let selected = 0,
			unselected = 0;
		const contexts: PromptOptions["contexts"] = new Map([
			[
				"selected",
				{
					id: "selected",
					placement: "system",
					render: () => {
						selected++;
						return "Selected context";
					},
				},
			],
			[
				"unselected",
				{
					id: "unselected",
					placement: "system",
					render: () => {
						unselected++;
						return "Unselected context";
					},
				},
			],
		]);
		await scaffoldWorkspace(files, ["selected"], contexts);
		const session = {
			id: "1",
			agent: "main",
			profile: "owner",
			cwd: directory,
			resolved: resolveProfile({ contexts: ["selected"] }),
		};
		const options = { contexts, workspace: () => files };
		expect(await systemSections(session, options)).toEqual(await systemSections(session, options));
		expect([selected, unselected]).toEqual([2, 0]);
		expect(framework(session).split(/\s+/u).length).toBeLessThanOrEqual(250);
		expect(framework(session)).not.toContain("yonder docs");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
