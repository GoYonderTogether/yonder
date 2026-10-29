import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { createSkills } from "./index.js";

const skill = async (path: string, name: string, description: string, body = name) => {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n---\n${body}`);
};

test("user .agents, Yonder home and project .agents shadow in order; index carries readable absolute paths", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "yonder-skill-layers-")));
	const userHome = join(root, "user"),
		home = join(root, "home"),
		repo = join(root, "repo"),
		cwd = join(repo, "packages", "app");
	try {
		await mkdir(join(repo, ".git"), { recursive: true });
		await mkdir(cwd, { recursive: true });
		await skill(join(userHome, ".agents", "skills", "shared", "SKILL.md"), "shared", "User shared");
		await skill(join(home, "skills", "shared", "SKILL.md"), "shared", "Home shared");
		await skill(join(repo, ".agents", "skills", "shared", "SKILL.md"), "shared", "Project shared");
		await skill(join(home, "skills", "homeonly", "SKILL.md"), "homeonly", "Home only");
		await skill(join(repo, ".agents", "skills", "projectonly", "SKILL.md"), "projectonly", "Repo root");
		await skill(join(cwd, ".agents", "skills", "projectonly", "SKILL.md"), "projectonly", "Cwd level");
		await skill(join(cwd, ".pi", "skills", "pi-skill", "SKILL.md"), "pi-skill", "Pi project");
		const skills = createSkills({ home, userHome, pluginDirs: [] });
		const session = { agent: null, profile: "default", cwd, resolved: resolveProfile({ skills: ["*"] }) };
		const report = await skills.inspect(session);
		const shared = report.skills.filter((entry) => entry.name === "shared");
		expect(shared.map((entry) => [entry.source, entry.description, entry.shadowed])).toEqual([
			["agents", "User shared", false],
			["home", "Home shared", true],
			["project-agents", "Project shared", true],
		]);
		expect(report.skills.find((entry) => entry.name === "projectonly" && !entry.shadowed)?.description).toBe(
			"Repo root",
		);
		expect(report.issues.some((issue) => issue.message.includes("name 冲突：shared"))).toBe(true);
		const location = join(userHome, ".agents", "skills", "shared", "SKILL.md");
		expect(report.index).toContain(
			`  <skill>\n    <name>shared</name>\n    <description>User shared</description>\n    <location>${location}</location>\n  </skill>`,
		);
		expect(report.index).toContain(`<location>${join(cwd, ".pi", "skills", "pi-skill", "SKILL.md")}</location>`);
		expect(report.index.startsWith("<available_skills>\n")).toBe(true);
		expect(await readFile(location, "utf8")).toContain("User shared");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("discovery stops at SKILL.md, accepts root .md files, skips dot, node_modules and ignored entries", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "yonder-skill-walk-")));
	const home = join(root, "home"),
		base = join(home, "skills");
	try {
		await skill(join(base, "outer", "SKILL.md"), "outer", "Outer");
		await skill(join(base, "outer", "inner", "SKILL.md"), "inner", "Nested under a skill root");
		await skill(join(base, "group", "deep", "SKILL.md"), "deep", "Grouped");
		await skill(join(base, "group", "loose.md"), "loose", "Non-root md file");
		await skill(join(base, "single.md"), "single", "Root file");
		await skill(join(base, ".hidden", "SKILL.md"), "hidden", "Dot dir");
		await skill(join(base, "node_modules", "dep", "SKILL.md"), "dep", "Dependency");
		await skill(join(base, "ignored", "SKILL.md"), "ignored", "Ignored");
		await writeFile(join(base, ".gitignore"), "ignored/\n");
		await mkdir(join(base, "noname"), { recursive: true });
		await writeFile(join(base, "noname", "SKILL.md"), "---\ndescription: Name falls back\n---\nbody");
		await mkdir(join(base, "nodesc"), { recursive: true });
		await writeFile(join(base, "nodesc", "SKILL.md"), "---\nname: nodesc\n---\nbody");
		const skills = createSkills({ home, pluginDirs: [] });
		const session = { agent: null, profile: "default", cwd: root, resolved: resolveProfile({ skills: ["*"] }) };
		const report = await skills.inspect(session);
		const names = report.skills.filter((entry) => entry.source === "home").map((entry) => entry.name);
		expect(names.sort()).toEqual(["deep", "noname", "outer", "single"]);
		expect(report.issues.some((issue) => issue.path.endsWith(join("nodesc", "SKILL.md")))).toBe(true);
		expect(report.issues.some((issue) => issue.message.includes("回退为目录名：noname"))).toBe(true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("/skill:name force-loads the selected skill and keeps the trailing request", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "yonder-skill-command-")));
	const home = join(root, "home");
	try {
		await skill(join(home, "skills", "notes", "SKILL.md"), "notes", "Notes", "Follow the notes procedure.");
		const skills = createSkills({ home, pluginDirs: [] });
		const session = { agent: null, profile: "default", cwd: root, resolved: resolveProfile({ skills: ["*"] }) };
		const loaded = await skills.command(session, "/skill:notes summarise today");
		expect(loaded).toContain("Follow the notes procedure.");
		expect(loaded?.endsWith("\n\nsummarise today")).toBe(true);
		expect(await skills.command(session, "/skill:notes")).toContain("Follow the notes procedure.");
		expect(await skills.command(session, "hello /skill:notes")).toBeUndefined();
		await expect(skills.command(session, "/skill:missing")).rejects.toThrow("未找到当前配置档选中的 skill：missing");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
