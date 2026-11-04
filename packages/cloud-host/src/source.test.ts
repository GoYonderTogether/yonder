import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveProfile } from "@yonder/bot-definition";
import { loadAgentConfig, loadPresetsFrom, loadYonderConfigFrom } from "@yonder/bot-definition/load";
import type { BotSource } from "@yonder/bot-definition/source";
import { watchConfig } from "@yonder/local-host/config/reload";
import { createFsBotSource } from "@yonder/local-host/kernel/source-fs";
import { systemPromptParts } from "@yonder/local-host/prompt/index";
import { expandTemplate, listTemplates } from "@yonder/local-host/prompt/templates";
import { createSkills } from "@yonder/local-host/skills/index";
import type { ContextContribution } from "@yonder/sdk";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDefinitions } from "./schema.js";
import { createPostgresBotSource } from "./source.js";
import { testPostgres } from "./test-postgres.js";

let database: Awaited<ReturnType<typeof testPostgres>>;
let root: string;
let disk: BotSource;
let postgres: BotSource;
const configText = "schema: 1\nagents:\n  - id: main\n    workspace: agents/main\n";
const agentText =
	"schema: 1\nowner: person:owner\nid: main\nname: 小未\ndefaultProfile: default\nprofiles:\n  default:\n    model: rightapi-glm/glm-5.3-flash\n    contexts: [default-agent-soul, default-agent-work]\n    capabilities: []\nbindings: []\n";

beforeAll(async () => {
	database = await testPostgres();
	await migrateDefinitions(database.pool);
	root = await mkdtemp(join(tmpdir(), "yonder-definition-fs-"));
	await mkdir(join(root, "agents/main"), { recursive: true });
	disk = createFsBotSource(root, { agents: () => [{ id: "main", workspace: "agents/main" }] });
	postgres = createPostgresBotSource(database.pool, "owner-a", "bot-a");
	const templates = resolve(import.meta.dirname, "../../../plugins/agent-presets/prompts/default-agent");
	for (const [path, content] of [
		["yonder.yaml", configText],
		["agents/main/agent.yaml", agentText],
		["agents/main/SOUL.md", await readFile(join(templates, "SOUL.md"), "utf8")],
		["agents/main/AGENTS.md", await readFile(join(templates, "AGENTS.md"), "utf8")],
	] as const) {
		await writeFile(join(root, path), content);
		await postgres.home.files.writeFile(path, content);
	}
}, 60000);

afterAll(async () => {
	await database?.close();
	if (root) await rm(root, { recursive: true, force: true });
});

test("fs and PostgreSQL definitions assemble byte-identical system prompt parts", async () => {
	async function assemble(source: BotSource) {
		const config = await loadYonderConfigFrom(source.home);
		const entry = config.agents![0]!;
		const files = source.workspace(entry);
		const agent = await loadAgentConfig(files, entry.id);
		const session = {
			agent: agent.id,
			profile: agent.defaultProfile,
			cwd: `${source.home.root}/${entry.workspace}`,
			id: "2",
			resolved: resolveProfile(agent.profiles[agent.defaultProfile]!, agent.defaults, entry.env, config.defaultModel),
		};
		const contexts = new Map<string, ContextContribution>([
			[
				"default-agent-soul",
				{ id: "default-agent-soul", placement: "system", render: (ctx) => ctx.workspace.read("SOUL.md") },
			],
			[
				"default-agent-work",
				{ id: "default-agent-work", placement: "system", render: (ctx) => ctx.workspace.read("AGENTS.md") },
			],
		]);
		return systemPromptParts(session, { contexts, workspace: () => files });
	}
	const expected = await assemble(disk);
	expect(await assemble(postgres)).toEqual(expected);
	expect(expected.filter((part) => part.key.startsWith("context-")).map((part) => part.key)).toEqual([
		"context-default-agent-soul",
		"context-default-agent-work",
	]);
});

test("virtual files isolate both tenant and Bot and reject paths escaping the workspace", async () => {
	const foreignTenant = createPostgresBotSource(database.pool, "owner-b", "bot-a");
	const foreignBot = createPostgresBotSource(database.pool, "owner-a", "bot-b");
	for (const source of [foreignTenant, foreignBot]) {
		expect(await source.home.files.exists("yonder.yaml")).toBe(false);
		await expect(source.home.files.readFile("yonder.yaml")).rejects.toMatchObject({ code: "ENOENT" });
	}
	const files = postgres.workspace({ id: "main", workspace: "agents/main" });
	await expect(files.readFile("../agent.yaml")).rejects.toThrow("escapes workspace");
	await expect(files.writeFile("../../yonder.yaml", "invalid")).rejects.toThrow("escapes workspace");
	expect(await postgres.home.files.readFile("yonder.yaml")).toBe(configText);
	expect(await files.list(".")).toEqual([
		{ name: "AGENTS.md", type: "file" },
		{ name: "SOUL.md", type: "file" },
		{ name: "agent.yaml", type: "file" },
	]);
});

test("PG source supplies presets, Markdown children, prompt templates and selected skills", async () => {
	for (const [path, text] of [
		[
			"presets/default.yaml",
			"schema: 1\ndescription: Complete a bounded general task.\nmodel: rightapi-glm/glm-5.3-flash\n",
		],
		[
			"agents/child.md",
			"---\nname: child\ndescription: Complete a bounded general task.\n---\nRead the supplied material.",
		],
		["agents/main/prompts/inspect.md", "---\ndescription: Inspect supplied material\n---\nInspect $ARGUMENTS"],
		[
			"agents/main/skills/source-check/SKILL.md",
			"---\nname: source-check\ndescription: Inspect supplied source material.\n---\nRead the supplied source.",
		],
	] as const)
		await postgres.home.files.writeFile(path, text);
	const presets = await loadPresetsFrom(postgres.home);
	expect([...presets.keys()]).toEqual(["default", "child"]);
	// These entry points are also used by the local kernel; the source determines where assets live.
	expect(await listTemplates(root, "main", "default", [], postgres)).toEqual([
		{ name: "inspect", description: "Inspect supplied material" },
	]);
	expect(await expandTemplate(root, "main", "/inspect supplied", [], "default", postgres)).toBe("Inspect supplied");
	const agent = await loadAgentConfig(postgres.workspace({ id: "main", workspace: "agents/main" }), "main");
	const session = {
		agent: "main",
		profile: "default",
		cwd: `${postgres.home.root}/agents/main`,
		resolved: resolveProfile(agent.profiles.default!),
	};
	const skills = createSkills({ home: root, pluginDirs: [], source: postgres });
	const report = await skills.inspect(session);
	expect(report.skills.map((skill) => skill.name)).toEqual(["source-check"]);
	expect((await skills.view(session, "source-check")).text).toContain("Read the supplied source.");
	await expect(skills.view(session, "source-check", "../agent.yaml")).rejects.toThrow("超出");
});

test("PG definitions keep reload and parse-failure callbacks on the shared loading path", async () => {
	const files = postgres.workspace({ id: "main", workspace: "agents/main" });
	const agents = new Map([["main", await loadAgentConfig(files, "main")]]);
	const presets = new Map();
	const events: string[] = [];
	const watcher = await watchConfig({
		home: root,
		source: postgres,
		agents,
		presets,
		workspaceFiles: () => files,
		validate: async () => {},
		onReload: (event) => {
			events.push(event.type);
		},
	});
	try {
		await files.writeFile("agent.yaml", agentText.replace("name: 小未", "name: 小未来源回读"));
		await watcher.reload();
		expect(agents.get("main")?.name).toBe("小未来源回读");
		expect([...presets.keys()]).toEqual(["default", "child"]);
		expect(events).toEqual(["config.reload"]);
		let observed = "";
		let failures = 0;
		await files.writeFile("agent.yaml", "id: main");
		await expect(
			loadAgentConfig(
				files,
				"main",
				(text) => {
					observed = text;
				},
				() => {
					failures++;
				},
			),
		).rejects.toThrow();
		expect(observed).toBe("id: main");
		expect(failures).toBe(1);
	} finally {
		watcher.close();
		await files.writeFile("agent.yaml", agentText);
	}
});
