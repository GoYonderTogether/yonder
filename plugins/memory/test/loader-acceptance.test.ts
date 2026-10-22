import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { type KernelServices, loadPlugins } from "../../../packages/core/src/plugins/index.js";

const unused = async (): Promise<never> => {
	throw new Error("unexpected service call");
};
it("loads built memory plugin and enforces owner, agent and approved-conversation boundaries in real handlers", async () => {
	const base = await mkdtemp(join(tmpdir(), "memory-loader-"));
	const home = join(base, "home"),
		root = join(base, "root");
	await mkdir(join(home, "node_modules/@yonder"), { recursive: true });
	await mkdir(join(root, "mine"), { recursive: true });
	try {
		await writeFile(join(home, "node_modules/@yonder/plugin-memory"), "");
		// Use a package link to this worktree's already-built plugin.
		const { symlink } = await import("node:fs/promises");
		await rm(join(home, "node_modules/@yonder/plugin-memory"));
		await symlink(join(process.cwd(), "plugins/memory"), join(home, "node_modules/@yonder/plugin-memory"), "dir");
		await writeFile(join(root, "mine/public.md"), "# Synthetic fixture\nOnly this synthetic public fact.\n");
		const services = {
			events: { emit: unused, ask: unused, query: unused },
			messages: { send: unused },
			credentials: { get: unused },
			sessions: {
				list: unused,
				get: unused,
				open: unused,
				submit: unused,
				abort: unused,
				close: unused,
				transcript: unused,
			},
			identity: {
				account: async (id: string) => (id === "acct:test:owner" ? { person: "person:owner" } : undefined),
				person: unused,
				createPerson: unused,
				link: unused,
				unlink: unused,
				relation: unused,
				lookup: unused,
			},
			services: { resolve: unused },
			models: new Proxy(
				{},
				{
					get: () => {
						throw new Error("model access forbidden");
					},
				},
			),
			log: { error() {} },
		} as unknown as KernelServices;
		const loaded = await loadPlugins(
			home,
			{
				schema: 1,
				plugins: [
					{
						use: "@yonder/plugin-memory",
						config: {
							root,
							owner: "person:owner",
							timezone: "UTC",
							allowedAgents: ["main"],
							allowedSourceConversations: ["conv:test:approved"],
						},
					},
				],
			},
			services,
		);
		const tools = loaded.tools.get("memory");
		expect(tools).toBeDefined();
		const read = tools?.find((t) => t.name === "memory_read");
		const search = tools?.find((t) => t.name === "memory_search");
		expect(read).toBeDefined();
		expect(search).toBeDefined();
		if (!read || !search) throw new Error("memory tool registration missing");
		const event = {
			id: "fixture",
			ts: new Date().toISOString(),
			type: "message.in",
			from: "acct:test:owner",
			conv: "conv:test:approved",
			data: { kind: "text", text: "read memory" },
		};
		const ctx = {
			agent: "main",
			profile: "default",
			session: "fixture",
			capabilities: ["read", "admin"],
			env: {} as never,
			event,
			signal: new AbortController().signal,
		};
		const result = await read.execute({ path: "mine/public.md" }, ctx);
		expect(result.isError).not.toBe(true);
		expect(result.text).toContain("Only this synthetic public fact.");
		expect((await search.execute({ terms: ["synthetic"] }, ctx)).isError).not.toBe(true);
		expect((await read.execute({ path: "mine/public.md" }, { ...ctx, agent: "other" })).isError).toBe(true);
		expect(
			(await read.execute({ path: "mine/public.md" }, { ...ctx, event: { ...event, conv: "conv:test:unapproved" } }))
				.isError,
		).toBe(true);
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});
