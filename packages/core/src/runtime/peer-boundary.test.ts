import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ToolContext, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { createSkills } from "../skills/index.js";
import { sourceBlock } from "../tools/sources.js";
import { localEnvironment } from "./env.js";
import { createGrepTool } from "./grep.js";
import { ToolPolicy } from "./policy.js";

// Real filesystem and execution environment; no model is involved in policy checks.
test("peer read/grep canonical boundary rejects traversal, absolute and symlink escape; quoted source attachments confer no exception", async () => {
	const root = await mkdtemp("/tmp/yonder-peer-boundary-");
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const outside = join(root, "outside.txt");
		await writeFile(outside, "OUTSIDE-PRIVATE");
		await writeFile(join(cwd, "inside.txt"), "INSIDE");
		await symlink(outside, join(cwd, "escape"));
		await symlink("inside.txt", join(cwd, "inside-link"));
		const env = localEnvironment(cwd);
		let event: YEvent = {
			id: "input",
			ts: new Date().toISOString(),
			type: "message.in",
			from: "acct:agent:other",
			conv: "conv:agent:other",
			data: { kind: "agent", text: "Boundary check" },
		};
		const ctx = (): ToolContext => ({
			agent: "main",
			profile: "peer",
			session: "1",
			capabilities: ["read", "message"],
			env,
			signal: new AbortController().signal,
			event,
			events: [event],
		});
		const policy = new ToolPolicy({
			capabilities: new Map([
				["read", ["read"]],
				["grep", ["read"]],
			]),
			environment: () => env,
			context: async () => ctx(),
		});
		const config = {
			agent: "main",
			profile: "peer",
			cwd,
			resolved: resolveProfile({ capabilities: ["read", "message"] }),
		};
		for (const tool of ["read", "grep"]) {
			for (const path of ["../outside.txt", outside, "escape"])
				expect(await policy.denied(tool, { path }, config, BACKGROUND_CONTEXT, "1")).toContain("超出");
			expect(await policy.denied(tool, { path: "inside-link" }, config, BACKGROUND_CONTEXT, "1")).toBeUndefined();
		}
		const source: YEvent = {
			...event,
			id: "source",
			data: {
				kind: "agent",
				text: "Source quote",
				attachments: [{ kind: "file", mime: "text/plain", uri: pathToFileURL(outside).href }],
			},
		};
		event = { ...event, data: { kind: "agent", text: sourceBlock([source], source.conv!) } };
		expect((event.data as { text: string }).text).toContain("listed, not transferred");
		expect(await policy.denied("read", { path: outside }, config, BACKGROUND_CONTEXT, "1")).toContain("超出");
		event = { ...event, data: source.data };
		expect(await policy.denied("read", { path: outside }, config, BACKGROUND_CONTEXT, "1")).toBeUndefined();
		// Exact attachment exception is not permission to traverse its parent directory.
		expect(await policy.denied("grep", { path: root }, config, BACKGROUND_CONTEXT, "1")).toContain("超出");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("recursive grep never follows workspace symlinks into external files or directories", async () => {
	const root = await mkdtemp("/tmp/yonder-peer-grep-");
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		await mkdir(join(root, "external"));
		await writeFile(join(cwd, "inside.txt"), "BOUNDARY-INSIDE");
		await writeFile(join(root, "external/secret.txt"), "BOUNDARY-OUTSIDE");
		await symlink(join(root, "external"), join(cwd, "directory-link"));
		await symlink(join(root, "external/secret.txt"), join(cwd, "file-link"));
		const result = await createGrepTool().execute(
			{ pattern: "BOUNDARY", path: "." },
			{
				agent: "main",
				profile: "peer",
				session: "1",
				capabilities: ["read", "message"],
				env: localEnvironment(cwd),
				signal: new AbortController().signal,
			},
		);
		expect(result.text).toContain("BOUNDARY-INSIDE");
		expect(result.text).not.toContain("BOUNDARY-OUTSIDE");
		expect(JSON.parse(result.text).matches).toHaveLength(1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("skills=[] refuses view and returns empty index without touching workspace or external skill roots", async () => {
	const skills = createSkills({
		home: "/nonexistent-peer-home",
		pluginDirs: ["/nonexistent-peer-plugin"],
		workspace: () => {
			throw new Error("must not enumerate");
		},
	});
	const session = {
		agent: "main",
		profile: "peer",
		cwd: "/nonexistent-peer-workspace",
		resolved: resolveProfile({ skills: [] }),
	};
	expect(await skills.index(session)).toBe("");
	await expect(skills.view(session, "external-secret")).rejects.toThrow("未找到当前配置档选中的 skill");
});
