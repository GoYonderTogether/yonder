import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { BoardService } from "../src/service.js";
import { type State, Store } from "../src/store/index.js";

const content = {
	title: "Activity protocol check",
	objective: "Verify scoped counts",
	acceptance: ["Counts"],
	nonGoals: [],
};
function caller(
	agent: string | null,
	session = "1",
	capabilities: ToolContext["capabilities"] = ["read"],
): ToolContext {
	return { agent, session, profile: "owner", capabilities, env: {} as never, signal: new AbortController().signal };
}

test("activity uses caller-visible real tasks once, with exact states and no task content", async () => {
	const directory = await mkdtemp(join(tmpdir(), "yonder-activity-tasks-"));
	const store = new Store(directory);
	const service = new BoardService(store, "en", 0);
	const a = caller("a"),
		b = caller("b"),
		child = caller("child");
	const add = (ctx: ToolContext, state: State, parent?: string) => {
		const task = store.open({ ...content, ...(parent ? { parent } : {}) }, ctx);
		if (state !== "open") store.update(task.id, { state: "active" }, ctx);
		if (state === "done") {
			store.update(task.id, { state: "review" }, ctx);
			store.done(task.id, "Protocol verified", ["Count asserted"], ctx);
		} else if (state !== "open" && state !== "active") store.update(task.id, { state }, ctx);
		return task;
	};
	await service.start();
	try {
		const parent = add(a, "blocked");
		const review = add(a, "review");
		const waiting = add(a, "waiting-user");
		add(a, "open");
		add(a, "active"); // stallMinutes=0 must never turn this into blocked.
		add(a, "done");
		add(a, "cancelled");
		const nested = add(child, "blocked", parent.id);
		add(child, "review", nested.id);
		add(b, "review");
		add(b, "done");
		add(caller(null, "task-session"), "blocked");
		const aURL = service.publish(a),
			bURL = service.publish(b);
		expect(service.publish(a)).toBe(aURL);
		expect(aURL).not.toBe(bURL);
		const read = async (url: string) => {
			const response = await fetch(`${url}?view=activity&id=not-a-task`);
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("no-store");
			return response.json();
		};
		const summary = await read(aURL);
		expect(summary).toEqual({
			schemaVersion: 1,
			observedAt: expect.any(Number),
			agents: [
				{ agentId: "a", blocked: 1, review: 1, waitingUser: 1 },
				{ agentId: "child", blocked: 1, review: 1, waitingUser: 0 },
			],
		});
		expect(summary.observedAt).toBeLessThanOrEqual(Date.now());
		expect(JSON.stringify(summary)).not.toContain(content.title);
		expect(JSON.stringify(summary)).not.toContain(parent.id);
		expect((await read(bURL)).agents).toEqual([{ agentId: "b", blocked: 0, review: 1, waitingUser: 0 }]);
		expect((await read(service.publish(caller("a", "1", ["read", "cross-agent"])))).agents).toHaveLength(3);
		// Null owners remain session-scoped and never become a guessed resident agent.
		expect((await read(service.publish(caller(null, "task-session")))).agents).toEqual([]);
		expect((await fetch(aURL)).status).toBe(200); // Existing board client remains compatible.
		expect((await fetch(`${aURL}?view=activity`, { headers: { Origin: "https://foreign.invalid" } })).status).toBe(403);
		expect((await fetch(new URL("/invalid-token?view=activity", aURL))).status).toBe(403);
		store.update(parent.id, { state: "active" }, a);
		store.update(waiting.id, { state: "active" }, a);
		store.done(review.id, "Verified", ["Done evidence"], a);
		expect((await read(aURL)).agents).toEqual([{ agentId: "child", blocked: 1, review: 1, waitingUser: 0 }]);
		await service.stop();
		await service.start();
		expect((await fetch(new URL(new URL(aURL).pathname, service.publish(a)))).status).toBe(403);
	} finally {
		await service.stop();
		store.close();
		await rm(directory, { recursive: true, force: true });
	}
});
