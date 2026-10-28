import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { localEnvironment } from "./env.js";
import { projectRules } from "./project-rules.js";

test("loads global and ancestor rules in priority order, deduplicates and bounds content", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-rules-"));
	try {
		const global = join(root, "global");
		const project = join(root, "project");
		const child = join(project, "child");
		await mkdir(global);
		await mkdir(child, { recursive: true });
		await writeFile(join(global, "AGENTS.md"), "global");
		await writeFile(join(project, "AGENTS.md"), "lower priority");
		await writeFile(join(project, "AGENTS.override.md"), "project");
		await symlink(join(global, "AGENTS.md"), join(child, "AGENTS.md"));
		const env = localEnvironment(root);
		const rules = await projectRules(env, child, env, global);
		expect(rules.filter((rule) => rule.path.startsWith(root))).toEqual([
			{ path: join(global, "AGENTS.md"), content: "global" },
			{ path: join(project, "AGENTS.override.md"), content: "project" },
		]);
		await rm(join(child, "AGENTS.md"));
		await writeFile(join(child, "CLAUDE.md"), "x".repeat(33 * 1024));
		const bounded = await projectRules(env, child, env, global);
		expect(bounded.at(-1)?.content).toBe(`${"x".repeat(32 * 1024)}\n[truncated]`);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
