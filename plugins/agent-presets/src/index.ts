import { readFile } from "node:fs/promises";
import { definePlugin } from "@yonder/sdk";

export default definePlugin({
	async setup(api) {
		for (const name of ["general", "coding", "research"]) {
			const text = await readFile(new URL(`../prompts/tasks/${name}.md`, import.meta.url), "utf8");
			api.contexts.register({ id: `task-${name}`, placement: "system", render: () => text.trim() });
		}
		for (const [id, description] of [
			["default", "Complete a bounded general task with explicit inputs and verifiable results."],
			["coding", "Implement and verify a software change in the specified repository."],
			["research", "Investigate supplied material and available web sources; return evidence and citations."],
		] as const) {
			api.presets.register({
				id,
				description,
				plugins: [api.id],
				contexts: id === "default" ? ["task-general"] : ["task-general", `task-${id}`],
			});
		}
		for (const [id, description] of [
			["jarvis", "Create a resident Jarvis: personal affairs, the local computer and Agent coordination."],
			["default-agent", "Create a resident collaborator with a configured name and remit."],
		] as const) {
			const contexts: string[] = [];
			for (const [suffix, path] of [
				["soul", "SOUL.md"],
				["work", "AGENTS.md"],
			] as const) {
				const context = `${id}-${suffix}`;
				const template = await readFile(new URL(`../prompts/${id}/${path}`, import.meta.url), "utf8");
				contexts.push(context);
				api.contexts.register({
					id: context,
					placement: "system",
					files: [{ path, scaffold: true, template }],
					async render(ctx) {
						if (!ctx.agent) return undefined;
						return (await ctx.workspace.read(path))?.trim() || undefined;
					},
				});
			}
			api.presets.register({
				id,
				description,
				plugins: [api.id],
				contexts,
			});
		}
	},
});
