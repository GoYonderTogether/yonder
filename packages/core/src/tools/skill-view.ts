import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import type { RuntimeSessionConfig } from "../runtime/types.js";
import type { Skills } from "../skills/index.js";

export function createSkillTool(skills: Skills, resolveSession: (id: string) => Promise<RuntimeSessionConfig>): Tool {
	return {
		name: "skill_view",
		description: "读取当前配置档选中的 skill 全文或其中一个文件。",
		parameters: Type.Object({ name: Type.String({ minLength: 1 }), path: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
		capabilities: [],
		async execute(args, ctx) {
			const input = args as { name: string; path?: string };
			return skills.view(await resolveSession(ctx.session), input.name, input.path);
		},
	};
}
