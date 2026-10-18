import { defineContext, definePlugin } from "@yonder/sdk";

const files = [
	["agents-md", "AGENTS.md", "Agent 工作规则", "记录 agent 在此工作区必须遵守的规则。"],
	["user-md", "USER.md", "用户资料", "记录帮助 agent 理解用户的资料。"],
	["soul-md", "SOUL.md", "行为方式", "记录 agent 的行为方式与沟通偏好。"],
	["memory-md", "MEMORY.md", "记忆", "记录供 agent 后续使用的事实与经验。"],
] as const;

export default definePlugin({
	setup(api) {
		for (const [id, path, title, description] of files) {
			api.contexts.register(
				defineContext({
					id,
					placement: "system",
					files: [{ path, scaffold: true, template: `# ${title}\n\n${description}\n` }],
					async render(context) {
						const content = await context.workspace.read(path);
						return content?.trim() ? content : undefined;
					},
				}),
			);
		}
	},
});
