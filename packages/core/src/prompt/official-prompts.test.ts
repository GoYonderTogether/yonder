import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { loadPresets, loadYonderConfig, parseAgentConfig, resolveProfile } from "../config/index.js";
import { initHome, inspectHome, openKernel } from "../kernel/index.js";
import { filesFor, inspectionServices, profileFor } from "../kernel/workspace.js";
import { loadPlugins } from "../plugins/index.js";
import { inspectToolCatalog } from "../runtime/index.js";
import { commonPrompt, residentPrompt, runtimePrompt } from "./content.js";
import { scaffoldWorkspace, systemSections } from "./index.js";

test("official resident templates load, scaffold and stay out of identity-less tasks without overwriting personal files", async () => {
	const directory = fileURLToPath(new URL("../../../../plugins/agent-presets", import.meta.url));
	expect(await checkPlugin(directory)).toEqual([]);
	const home = await mkdtemp("/tmp/yonder-official-prompts-");
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home);
		kernel = await openKernel(home);
		await kernel.management({
			action: "agents.create",
			id: "prompt-check",
			preset: "default-agent",
			value: {
				name: "Prompt verification",
				work: "Verify official prompt assembly",
				owner: "person:owner",
				bindings: [],
			},
		});
		const config = await loadYonderConfig(home);
		const plugins = await loadPlugins(
			home,
			config,
			inspectionServices(home, config, () => {}),
		);
		for (const [id, role] of [
			["main", "jarvis"],
			["prompt-check", "default-agent"],
		] as const) {
			const files = filesFor(home, config, plugins, id);
			const agent = parseAgentConfig(await files.readFile("agent.yaml"));
			const session = { id, ...profileFor(home, config, agent) };
			expect(session.resolved.contexts).toEqual([`${role}-soul`, `${role}-work`]);
			const soul = (await files.readFile("SOUL.md")).trim();
			const work = (await files.readFile("AGENTS.md")).trim();
			expect(soul).toBe((await readFile(`${directory}/prompts/${role}/SOUL.md`, "utf8")).trim());
			expect(work).toBe((await readFile(`${directory}/prompts/${role}/AGENTS.md`, "utf8")).trim());
			const options = { contexts: plugins.contexts, workspace: () => files };
			const sections = await systemSections(session, options);
			expect(sections).toEqual(await systemSections(session, options));
			for (const block of [commonPrompt, residentPrompt, runtimePrompt]) expect(sections.join("\n\n")).toContain(block);
			expect(sections.slice(-2)).toEqual([soul, work]);
			expect(sections.join("\n").includes("You are Jarvis.")).toBe(role === "jarvis");
			// A real edit survives scaffolding; intentional blanking does not restore the template.
			const edited = `${soul}\n\nKeep this workspace's reviewed wording.\n`;
			await files.writeFile("SOUL.md", edited);
			await files.writeFile("AGENTS.md", "\n");
			await scaffoldWorkspace(files, session.resolved.contexts, plugins.contexts);
			expect(await files.readFile("SOUL.md")).toBe(edited);
			expect(await files.readFile("AGENTS.md")).toBe("\n");
			const changed = await systemSections(session, options);
			expect(changed.at(-1)).toBe(edited.trim());
			expect(changed).not.toContain(work);
		}
		await kernel.management({
			action: "agents.update",
			id: "main",
			value: {
				profiles: {
					...parseAgentConfig(await readFile(`${home}/agents/main/agent.yaml`, "utf8")).profiles,
					owner: {
						level: "bypass",
						contexts: [],
						skills: [],
						prompt: { sections: ["framework"], overrides: { framework: "Local prompt configuration verification." } },
					},
				},
			},
		});
		const files = filesFor(home, config, plugins, "main");
		const configured = {
			id: "main",
			...profileFor(home, config, parseAgentConfig(await files.readFile("agent.yaml"))),
		};
		expect(await systemSections(configured, { contexts: plugins.contexts, workspace: () => files })).toEqual([
			"Local prompt configuration verification.",
		]);
		const saved = await files.readFile("agent.yaml");
		await expect(
			kernel.management({
				action: "agents.update",
				id: "main",
				value: {
					profiles: {
						...parseAgentConfig(await readFile(`${home}/agents/main/agent.yaml`, "utf8")).profiles,
						owner: { prompt: { sections: ["missing-section"] } },
					},
				},
			}),
		).rejects.toThrow("Unknown prompt section");
		expect(await files.readFile("agent.yaml")).toBe(saved);

		for (const preset of ["default", "coding", "research", "jarvis", "default-agent"]) {
			const selected = plugins.presets.get(preset) ?? {};
			const task = { id: "task", agent: null, profile: preset, cwd: home, resolved: resolveProfile(selected) };
			const sections = await systemSections(task, {
				contexts: plugins.contexts,
				workspace: () => {
					throw new Error("Task must not read a resident workspace");
				},
			});
			expect(sections.join("\n\n")).toContain(commonPrompt);
			expect(sections.join("\n\n")).not.toContain(residentPrompt);
			expect(sections.join("\n")).not.toMatch(/You are Jarvis|# SOUL.md|# AGENTS.md/u);
		}
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);

test("official tasks select real tools, share work-session presets and allow short replacements without leaking resident files", async () => {
	const home = await mkdtemp("/tmp/yonder-task-presets-");
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home);
		const config = await loadYonderConfig(home);
		const plugins = await loadPlugins(
			home,
			config,
			inspectionServices(home, config, () => {}),
		);
		const presets = new Map([...plugins.presets, ...(await loadPresets(home))]);
		const workspace = () => {
			throw new Error("Tasks must not read resident files");
		};
		for (const id of ["default", "coding", "research"]) {
			const task = {
				id: `task-${id}`,
				agent: null,
				profile: id,
				cwd: home,
				resolved: resolveProfile(presets.get(id)!),
			};
			const sections = await systemSections(task, { contexts: plugins.contexts, workspace });
			const names = id === "default" ? ["general"] : ["general", id];
			const expected = await Promise.all(
				names.map((name) =>
					readFile(new URL(`../../../../plugins/agent-presets/prompts/tasks/${name}.md`, import.meta.url), "utf8").then(
						(text) => text.trim(),
					),
				),
			);
			expect(sections.slice(-names.length)).toEqual(expected);
			expect(sections.join("\n")).not.toContain(residentPrompt);
			// Official presets specialise only model and context; tools and permissions come from the opener.
			const preset = plugins.presets.get(id)!;
			expect(preset.tools).toBeUndefined();
			expect(preset.capabilities).toBeUndefined();
			expect(preset.level).toBeUndefined();
		}
		kernel = await openKernel(home);
		const session = await kernel.sessions.open({ preset: "coding", close: "manual" });
		expect((await kernel.terminal.info(session.id)).config.resolved.contexts).toEqual(["task-general", "task-coding"]);
		await kernel.sessions.close(session.id);
		await kernel.management({
			action: "presets.update",
			id: "coding",
			value: {
				contexts: [],
				skills: [],
				prompt: { sections: ["framework"], overrides: { framework: "Local coding work." } },
				instructions: "Use the supplied repository and return checked results.",
			},
		});
		const short = (await loadPresets(home)).get("coding")!;
		expect(short.instructions).toBe("Use the supplied repository and return checked results.");
		expect(short.tools).toEqual(presets.get("coding")!.tools);
		expect(
			await systemSections(
				{ id: "short", agent: null, profile: "coding", cwd: home, resolved: resolveProfile(short) },
				{ contexts: plugins.contexts, workspace },
			),
		).toEqual(["Local coding work."]);
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);

test("adding task presets keeps older homes without web-tools and customized default presets valid", async () => {
	const home = await mkdtemp("/tmp/yonder-existing-presets-");
	try {
		await initHome(home);
		const config = await loadYonderConfig(home);
		config.plugins = config.plugins!.filter((plugin) => plugin.use !== "@yonder/plugin-web-tools");
		await writeFile(`${home}/yonder.yaml`, stringify(config));
		await rm(`${home}/presets/research.yaml`);
		await writeFile(
			`${home}/presets/default.yaml`,
			stringify({
				schema: 1,
				description: "Existing task configuration",
				model: "openai/gpt-6-luna",
				capabilities: ["read"],
				contexts: [],
				instructions: "Keep this task instruction.",
			}),
		);
		expect(await inspectHome(home)).toMatchObject({ ok: true, errors: [] });
		const plugins = await loadPlugins(
			home,
			config,
			inspectionServices(home, config, () => {}),
		);
		const presets = new Map([...plugins.presets, ...(await loadPresets(home))]);
		expect(presets.get("default")).toMatchObject({ contexts: [], instructions: "Keep this task instruction." });
		expect(presets.get("research")?.plugins).toEqual(["agent-presets"]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 30000);
