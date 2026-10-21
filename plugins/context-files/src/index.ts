import { defineContext, definePlugin } from "@yonder/sdk";

const files = [
	["agents-md", "AGENTS.md", "How you work: your remit, and how you take on and carry out tasks."],
	["user-md", "USER.md", "What you know about the people you serve."],
	["soul-md", "SOUL.md", "Who you are: your voice, the role you play, your taste."],
	["memory-md", "MEMORY.md", "Facts and lessons worth keeping for later."],
] as const;

export default definePlugin({
	setup(api) {
		for (const [id, path, description] of files) {
			const template = `# ${path}\n\n${description}\n`;
			api.contexts.register(
				defineContext({
					id,
					placement: "system",
					files: [{ path, scaffold: true, template }],
					async render(context) {
						const content = await context.workspace.read(path);
						// An untouched scaffold says nothing about the agent; keep it out of the prompt.
						return content?.trim() && content.trim() !== template.trim() ? content : undefined;
					},
				}),
			);
		}
	},
});
