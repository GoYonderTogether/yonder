import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PluginAPI, ToolContext, ViewDecl, ViewProvider } from "@yonder/sdk";
import { createFilePluginStorage, tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { Store } from "../src/store/index.js";
import { registerTaskViews } from "../src/views.js";

test("task board shows only the requested session and advances its revision", async () => {
	const dir = await tempHome("yonder-task-views-");
	const store = new Store(createFilePluginStorage(dir).open());
	let decl!: ViewDecl;
	let provider!: ViewProvider;
	registerTaskViews(
		{
			views: {
				register: (d: ViewDecl, p: ViewProvider) => {
					decl = d;
					provider = p;
				},
			},
		} as PluginAPI,
		store,
	);
	const ctx = (session: string) =>
		({
			agent: null,
			session,
			profile: "owner",
			capabilities: ["write"],
			env: {},
			signal: new AbortController().signal,
		}) as ToolContext;
	const content = { title: "Visible task", objective: "Test board", acceptance: ["one", "two"], nonGoals: [] };
	try {
		const task = await store.open(content, ctx("one"));
		await store.open({ ...content, title: "Other session" }, ctx("two"));
		const before = await provider.data("one");
		expect(decl).toMatchObject({ id: "tasks.board", scope: "session" });
		expect(before.content).toEqual({ type: "list", items: [{ id: task.id, title: task.title, subtitle: "open" }] });
		await store.update(task.id, { state: "active" }, ctx("one"));
		const after = await provider.data("one");
		expect(after.rev).toBeGreaterThan(before.rev);
		expect(after.content).toMatchObject({ items: [{ subtitle: "active" }] });
	} finally {
		await store.close();
		await rm(dir, { recursive: true, force: true });
	}
});
