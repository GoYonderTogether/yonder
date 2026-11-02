import { posix } from "node:path";
import type { BotSource, SkillSource, SourceSession } from "@yonder/bot-definition/source";
import { definitionTemplates } from "@yonder/bot-definition/source";
import type { Pool } from "pg";
import { postgresDirectory } from "./files.js";

/** PostgreSQL definition source; no cloud directory is exposed to the Bot. */
export function createPostgresBotSource(pool: Pool, tenant: string, bot: string): BotSource {
	const root = `/bots/${encodeURIComponent(bot)}`;
	const home = postgresDirectory(pool, tenant, bot, root);
	const directory = (workspace: string) => {
		const path = posix.normalize(posix.isAbsolute(workspace) ? posix.relative(root, workspace) : workspace);
		if (path === ".." || path.startsWith("../")) throw new Error("Virtual workspace path escapes Bot");
		return postgresDirectory(pool, tenant, bot, posix.join(root, path), path);
	};
	const skill = (path: string, source: "home" | "workspace"): SkillSource => {
		const entry = directory(path);
		return {
			...entry,
			base: "skills",
			source,
			location: source === "workspace" ? "workspace:virtual" : "home",
			canonical: async (path) => {
				const resolved = posix.resolve(entry.root, path);
				const relative = posix.relative(entry.root, resolved);
				if (relative === ".." || relative.startsWith("../")) throw new Error("Skill path escapes source");
				return resolved;
			},
		};
	};
	return {
		home,
		workspace: (entry) => directory(entry.workspace).files,
		templates: (session, plugins) => definitionTemplates(home, session, plugins),
		async skills(session: SourceSession, plugins = []) {
			return [
				...(session.agent ? [skill(posix.relative(root, session.cwd), "workspace")] : []),
				skill(".", "home"),
				...plugins,
			];
		},
	};
}
