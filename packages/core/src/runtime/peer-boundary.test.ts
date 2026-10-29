import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { HASH_SEP } from "@earendil-works/pi-durable/tools";
import type { ToolContext, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { createSkills } from "../skills/index.js";
import { sourceBlock } from "../tools/sources.js";
import { localEnvironment } from "./env.js";
import { createGrepTool } from "./grep.js";
import { ToolPolicy } from "./policy.js";

// Real filesystem and execution environment; no model is involved in policy checks.
test("peer read/grep canonical boundary rejects traversal, absolute and symlink escape; quoted source attachments confer no exception", async () => {
	const root = await mkdtemp(join(tmpdir(), "ya-"));
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
			home: root,
			capabilities: new Map([
				["read", ["read"]],
				["grep", ["read"]],
				["ls", ["read"]],
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
		const cachePath = await (await import("./tool-output-cache.js")).cacheToolOutput(root, "1", "test", {}, "cached");
		for (const tool of ["read", "grep"]) {
			expect(await policy.denied(tool, { path: cachePath }, config, BACKGROUND_CONTEXT, "1")).toBeUndefined();
			expect(await policy.denied(tool, { path: cachePath }, config, BACKGROUND_CONTEXT, "2")).toContain("超出");
			const execConfig = { ...config, resolved: resolveProfile({ capabilities: ["read", "exec"] }) };
			expect(await policy.denied(tool, { path: cachePath }, execConfig, BACKGROUND_CONTEXT, "1")).toBeUndefined();
			expect(await policy.denied(tool, { path: cachePath }, execConfig, BACKGROUND_CONTEXT, "2")).toContain("超出");
		}
		for (const tool of ["read", "grep", "ls"]) {
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
	const root = await mkdtemp(join(tmpdir(), "ya-"));
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
		// One hit is one `line:│ anchor│content` row, and its anchor edits that line without another read.
		expect(result.text.match(/BOUNDARY-INSIDE/g)).toHaveLength(1);
		const row = result.text.split("\n").find((line) => line.includes("BOUNDARY-INSIDE")) ?? "";
		const [gutter, served] = row.split(`${HASH_SEP} `);
		expect(gutter).toBe("1:");
		const [anchor = "", ...rest] = (served ?? "").split(HASH_SEP);
		expect(anchor).toMatch(/^[a-z]{5}$/);
		expect(rest.join(HASH_SEP)).toBe("BOUNDARY-INSIDE");
		const { createReplaceTool } = await import("@earendil-works/pi-durable/tools");
		await createReplaceTool().execute(
			{ path: "inside.txt", remove_from: anchor, remove_to: anchor, text: "EDITED" },
			{ env: localEnvironment(cwd) } as import("@earendil-works/pi-durable").ToolExecutionApi,
			BACKGROUND_CONTEXT,
		);
		expect(await readFile(join(cwd, "inside.txt"), "utf8")).toBe("EDITED");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("anchor edits are checked against the file that served the anchors, with or without a path", async () => {
	const { createReadTool } = await import("@earendil-works/pi-durable/tools");
	const root = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		const cwd = join(root, "workspace");
		await mkdir(cwd);
		const outside = join(root, "outside.txt");
		await writeFile(outside, "OUTSIDE-PRIVATE");
		await writeFile(join(cwd, "inside.txt"), "INSIDE");
		await writeFile(join(cwd, "agent.yaml"), "id: main");
		const env = localEnvironment(cwd);
		const policy = new ToolPolicy({
			home: root,
			capabilities: new Map([
				["read", ["read"]],
				["replace", ["write"]],
			]),
			environment: () => env,
			context: async () => ({
				agent: "main",
				profile: "peer",
				session: "1",
				capabilities: ["read", "write"],
				env,
				signal: new AbortController().signal,
			}),
		});
		const config = {
			agent: "main",
			profile: "peer",
			cwd,
			resolved: resolveProfile({ capabilities: ["read", "write"] }),
		};
		const anchorOf = async (path: string): Promise<string> => {
			const read = await createReadTool().execute(
				{ path },
				{ env } as import("@earendil-works/pi-durable").ToolExecutionApi,
				BACKGROUND_CONTEXT,
			);
			const row = (read.output ?? []).find((part) => part.type === "text");
			if (row?.type !== "text") throw new Error("read served no row");
			return row.text.slice(0, 5);
		};
		const edit = (anchor: string) => ({ remove_from: anchor, remove_to: anchor, text: "EDITED" });
		expect(await policy.denied("replace", edit(await anchorOf(outside)), config, BACKGROUND_CONTEXT, "1")).toContain(
			"超出",
		);
		expect(
			await policy.denied("replace", edit(await anchorOf(join(cwd, "agent.yaml"))), config, BACKGROUND_CONTEXT, "1"),
		).toContain("受保护文件");
		expect(
			await policy.denied("replace", edit(await anchorOf(join(cwd, "inside.txt"))), config, BACKGROUND_CONTEXT, "1"),
		).toBeUndefined();
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
