import { mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { loadYonderConfig, parseAgentConfig, resolveProfile } from "../config/index.js";
import { initHome, openKernel } from "../kernel/index.js";
import { filesFor, inspectionServices, profileFor } from "../kernel/workspace.js";
import { loadPlugins } from "../plugins/index.js";
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
					profiles: { owner: { prompt: { sections: ["missing-section"] } } },
				},
			}),
		).rejects.toThrow("Unknown prompt section");
		expect(await files.readFile("agent.yaml")).toBe(saved);

		for (const preset of ["default", "jarvis", "default-agent"]) {
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
