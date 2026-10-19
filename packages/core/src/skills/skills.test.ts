import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { localEnvironment, workspaceFiles } from "../runtime/env.js";
import { createSkills } from "./index.js";
import { addLocalSkill, removeLocalSkill } from "./manage.js";

test("workspace skill shadows home and skill_view stays inside its directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-skills-"));
	const home = join(root, "home"),
		workspaceRoot = join(root, "workspace");
	try {
		await mkdir(join(home, "skills", "notes"), { recursive: true });
		await mkdir(join(workspaceRoot, "skills", "notes"), { recursive: true });
		await writeFile(
			join(home, "skills", "notes", "SKILL.md"),
			"---\nname: notes\ndescription: Home notes\n---\nHome skill",
		);
		await writeFile(
			join(workspaceRoot, "skills", "notes", "SKILL.md"),
			"---\nname: notes\ndescription: Workspace notes\n---\nWorkspace skill",
		);
		await writeFile(join(workspaceRoot, "skills", "notes", "guide.md"), "Workspace guide");
		const skills = createSkills({
			home,
			pluginDirs: [],
			workspace: () => ({
				files: workspaceFiles(localEnvironment(workspaceRoot)),
				root: workspaceRoot,
				location: "workspace",
				env: localEnvironment(workspaceRoot),
			}),
		});
		const session = {
			agent: "main",
			profile: "default",
			cwd: workspaceRoot,
			resolved: resolveProfile({ skills: ["*"] }),
		};
		const report = await skills.inspect(session);
		expect(report.skills.map((skill) => [skill.source, skill.shadowed, skill.indexed])).toEqual([
			["workspace", false, true],
			["home", true, false],
			["builtin", false, true],
			["builtin", false, true],
			["builtin", false, true],
			["builtin", false, true],
		]);
		expect(await skills.index(session)).toBe(report.index);
		expect((await skills.view(session, "notes", "guide.md")).text).toContain("Workspace guide");
		await expect(skills.view(session, "notes", "../../outside.txt")).rejects.toThrow("超出 skill 目录");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("local import preserves resources, rejects overwrite, and removal preserves the source", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-skills-manage-"));
	try {
		const source = join(root, "source"),
			home = join(root, "home");
		await mkdir(join(source, "references"), { recursive: true });
		await mkdir(home);
		await writeFile(join(source, "SKILL.md"), "---\nname: notes\ndescription: Import boundary\n---\nInstructions");
		await writeFile(join(source, "references", "guide.txt"), "resource");
		const imported = await addLocalSkill(source, { home });
		expect(await readFile(join(imported.directory, "references", "guide.txt"), "utf8")).toBe("resource");
		await expect(addLocalSkill(source, { home })).rejects.toThrow();
		await removeLocalSkill("notes", { home });
		expect(await readFile(join(source, "SKILL.md"), "utf8")).toContain("Instructions");
		await expect(readFile(join(imported.directory, "SKILL.md"))).rejects.toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("management rejects linked roots/resources and never follows removal links", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-skills-links-"));
	try {
		const home = join(root, "home"),
			source = join(root, "source"),
			outside = join(root, "outside");
		await mkdir(join(home, "skills"), { recursive: true });
		await mkdir(source);
		await mkdir(outside);
		await writeFile(join(source, "SKILL.md"), "---\nname: notes\ndescription: Link boundary\n---\n");
		await writeFile(join(outside, "keep"), "keep");
		await symlink(outside, join(source, "escape"));
		await expect(addLocalSkill(source, { home })).rejects.toThrow("符号链接");
		await symlink(outside, join(home, "skills", "notes"));
		await expect(removeLocalSkill("notes", { home })).rejects.toThrow("符号链接");
		expect(await readFile(join(outside, "keep"), "utf8")).toBe("keep");
		await expect(removeLocalSkill("../outside", { home })).rejects.toThrow("名称无效");
		await rm(join(home, "skills"), { recursive: true });
		await symlink(outside, join(home, "skills"));
		await rm(join(source, "escape"));
		await expect(addLocalSkill(source, { home })).rejects.toThrow("符号链接");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("home shadows plugin with actual source id; selection and disabled invocation remain separate", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-skills-sources-"));
	try {
		const home = join(root, "home"),
			plugin = join(root, "plugin");
		await mkdir(join(home, "skills", "notes"), { recursive: true });
		await mkdir(plugin);
		await writeFile(
			join(home, "skills", "notes", "SKILL.md"),
			"---\nname: notes\ndescription: Home\ndisable-model-invocation: true\n---\nHome",
		);
		await writeFile(join(plugin, "SKILL.md"), "---\nname: notes\ndescription: Plugin\n---\nPlugin");
		const skills = createSkills({ home, pluginDirs: [plugin], pluginSources: new Map([[plugin, "actual-plugin"]]) });
		const session = { agent: null, profile: "default", cwd: home, resolved: resolveProfile({ skills: [] }) };
		const report = await skills.inspect(session);
		expect(report.skills.map((skill) => [skill.source, skill.shadowed, skill.selected, skill.indexed])).toEqual([
			["home", false, false, false],
			["plugin:actual-plugin", true, false, false],
			["builtin", false, false, false],
			["builtin", false, false, false],
			["builtin", false, false, false],
			["builtin", false, false, false],
		]);
		expect((await skills.show(session, "notes")).skill.source).toBe("home");
		await expect(skills.view(session, "notes")).rejects.toThrow("未找到");
		const selected = { ...session, resolved: resolveProfile({ skills: ["notes"] }) };
		expect(await skills.index(selected)).toBe("");
		expect((await skills.view(selected, "notes")).text).toContain("Home");
		await writeFile(join(root, "outside"), "private");
		await symlink(join(root, "outside"), join(home, "skills", "notes", "escape"));
		await expect(skills.view(selected, "notes", "escape")).rejects.toThrow("超出 skill 目录");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("bundled skills expose only an index until requested", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-builtin-skills-"));
	try {
		const skills = createSkills({ home, pluginDirs: [] });
		for (const agent of ["main", "operator", null]) {
			const session = { agent, profile: "default", cwd: home, resolved: resolveProfile({}) };
			const report = await skills.inspect(session);
			expect(
				report.skills.filter((skill) => skill.source === "builtin" && skill.indexed).map((skill) => skill.name),
			).toEqual(["skill-creator", "yonder-development", "yonder-plugin-debug", "yonder-self-management"]);
			expect(report.index).not.toContain("# Skill Creator");
			expect(report.index).not.toContain("# Yonder 插件调试");
			expect(report.index).not.toContain("# Yonder 自管理");
			expect((await skills.view(session, "yonder-self-management")).text).toContain("# Yonder 自管理");
			expect((await skills.view(session, "yonder-self-management", "references/management.md")).text).toContain(
				"# 管理事实",
			);
			expect((await skills.view(session, "yonder-plugin-debug")).text).toContain("# Yonder 插件调试");
			expect((await skills.view(session, "yonder-plugin-debug", "references/scenarios.md")).text).toContain(
				"# 场景线路",
			);
			expect((await skills.view(session, "skill-creator")).text).toContain("# Skill Creator");
			expect((await skills.view(session, "skill-creator", "references/openai_yaml.md")).text).toContain("interface");
			expect(await skills.index({ ...session, resolved: resolveProfile({ skills: [] }) })).toBe("");
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
