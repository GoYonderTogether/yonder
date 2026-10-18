import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { localEnvironment, workspaceFiles } from "../runtime/env.js";
import { createSkills } from "./index.js";

test("workspace skill shadows home and skill_view stays inside its directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-skills-"));
	const home = join(root, "home"), workspaceRoot = join(root, "workspace");
	try {
		await mkdir(join(home, "skills", "notes"), { recursive: true });
		await mkdir(join(workspaceRoot, "skills", "notes"), { recursive: true });
		await writeFile(join(home, "skills", "notes", "SKILL.md"), "---\nname: notes\ndescription: Home notes\n---\nHome skill");
		await writeFile(join(workspaceRoot, "skills", "notes", "SKILL.md"), "---\nname: notes\ndescription: Workspace notes\n---\nWorkspace skill");
		await writeFile(join(workspaceRoot, "skills", "notes", "guide.md"), "Workspace guide");
		const skills = createSkills({
			home,
			pluginDirs: [],
			workspace: () => ({ files: workspaceFiles(localEnvironment(workspaceRoot)), root: workspaceRoot, location: "workspace", env: localEnvironment(workspaceRoot) }),
		});
		const session = { agent: "main", profile: "default", cwd: workspaceRoot, resolved: resolveProfile({ skills: ["*"] }) };
		const report = await skills.inspect(session);
		expect(report.skills.map(skill => [skill.source, skill.shadowed, skill.indexed])).toEqual([["workspace", false, true], ["home", true, false]]);
		expect(await skills.index(session)).toBe(report.index);
		expect((await skills.view(session, "notes", "guide.md")).text).toContain("Workspace guide");
		await expect(skills.view(session, "notes", "../../outside.txt")).rejects.toThrow("超出 skill 目录");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
