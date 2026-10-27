import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { BoardService } from "../src/service.js";
import { Store } from "../src/store.js";

const caller = (agent: string | null, session = "test"): ToolContext => ({
	agent,
	session,
	profile: "owner",
	capabilities: ["read"],
	env: {} as never,
	signal: new AbortController().signal,
});
const content = {
	title: "Panel protocol test",
	objective: "Test preview only",
	acceptance: ["Protocol", "Visibility"],
	nonGoals: [],
};
test("panel projects only visible task/agent fields, hides invisible parents and preserves recorded actions", async () => {
	const dir = await mkdtemp(join(tmpdir(), "yonder-panel-"));
	const store = new Store(dir);
	const service = new BoardService(store, "zh-CN", 30, async () => [
		{ id: "a", name: "Protocol A", avatarUrl: "https://example.invalid/test-avatar", privateConfig: "NEVER-PROJECT" },
		{ id: "b", name: "Invisible B" },
	]);
	await service.start();
	try {
		const a = caller("a"),
			b = caller("b");
		const hidden = store.open({ ...content, title: "HIDDEN-PARENT" }, b);
		const task = store.open({ ...content, parent: hidden.id }, a);
		store.update(task.id, { state: "active", note: "Old progress is not a user action" }, a);
		store.update(task.id, { state: "waiting-user" }, a);
		const cancelled = store.open(content, a);
		store.update(cancelled.id, { state: "cancelled" }, a);
		const url = service.publish(a);
		let result = await (await fetch(`${url}?view=panel`)).json();
		expect(result.panel.tasks).toHaveLength(2);
		expect(result.panel.tasks.find((t: { id: string }) => t.id === task.id)).toMatchObject({
			parent: null,
			progress: null,
		});
		expect(result.panel.agents).toEqual([
			{ id: "a", name: "Protocol A", avatarUrl: "https://example.invalid/test-avatar" },
		]);
		expect(JSON.stringify(result)).not.toContain(hidden.id);
		expect(JSON.stringify(result)).not.toContain("HIDDEN-PARENT");
		expect(JSON.stringify(result)).not.toContain("NEVER-PROJECT");
		expect(JSON.stringify(result)).not.toContain("archived");
		store.update(task.id, { note: "Approve the recorded test document" }, a);
		result = await (await fetch(`${url}?view=panel&id=${task.ref}`)).json();
		expect(result.panel.selectedId).toBe(task.id);
		expect(result.panel.tasks.find((t: { id: string }) => t.id === task.id).progress).toBe(
			"Approve the recorded test document",
		);
		expect((await fetch(`${url}?view=panel&id=${hidden.id}`)).status).toBe(400);
		expect((await fetch(`${url}?view=panel`, { headers: { Origin: "https://foreign.invalid" } })).status).toBe(403);
		expect((await fetch(new URL("/bad?view=panel", url))).status).toBe(403);
		const worker = caller(null, "worker");
		store.open(content, worker);
		expect((await (await fetch(`${service.publish(worker)}?view=panel`)).json()).panel.agents).toEqual([]);
	} finally {
		await service.stop();
		await rm(dir, { recursive: true, force: true });
	}
});
