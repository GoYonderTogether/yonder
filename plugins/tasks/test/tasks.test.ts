import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RenderContext, ToolContext } from "@yonder/sdk";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { openKernel } from "../../../packages/core/src/kernel/index.js";
import { inspectionServices } from "../../../packages/core/src/kernel/workspace.js";
import { loadPlugins } from "../../../packages/core/src/plugins/index.js";
import { prepareInput } from "../../../packages/core/src/prompt/index.js";
import { DONE, GET, LIST, OPEN, SHOW, TURN_ONE_LINE, UPDATE } from "../src/prompts.js";
import { Store, type Task } from "../src/store/index.js";

// Protocol fixtures only. SQLite, plugin loading and kernel are real; no model calls.
const content = {
	title: "Verify task ledger",
	objective: "Persist task changes and recover their history",
	acceptance: ["SQLite rows preserve the original event", "Reopened store returns the latest state"],
	nonGoals: ["Model evaluation"],
};
function caller(agent: string | null = "main", session = "1"): ToolContext {
	return {
		agent,
		session,
		profile: "owner",
		capabilities: ["read", "write"],
		env: {} as never,
		signal: new AbortController().signal,
	};
}
function renderContext(event = "1", session = "1"): RenderContext {
	return {
		agent: "main",
		profile: "owner",
		session,
		workspace: { read: async () => undefined },
		event: { id: event, ts: new Date().toISOString(), type: "session.input", data: { text: "Inspect the ledger" } },
	};
}
async function temporary() {
	return mkdtemp(join(tmpdir(), "yonder-tasks-"));
}

test("built manifest matches registration without creating a store at setup", async () => {
	expect(await checkPlugin(resolve("plugins/tasks"))).toEqual([]);
	expect(existsSync("plugins/tasks/.yonder-contract-data")).toBe(false);
});

test("state transitions resume through active, reject shortcuts and retain terminal state", async () => {
	const root = await temporary(),
		store = new Store(root),
		ctx = caller();
	try {
		const task = store.open(content, ctx);
		expect(task).toMatchObject({ state: "open", ownerAgent: "main", session: "1", parent: null });
		expect(task.origin).toBeUndefined();
		expect(() => store.open({ ...content, origin: "free text" }, ctx)).toThrow("valid conversation reference");
		expect(() => store.open({ ...content, origin: "session:1" }, ctx)).toThrow("valid conversation reference");
		expect(() => store.update(task.id, { state: "review" }, ctx)).toThrow("Invalid task transition");
		expect(() => store.done(task.id, "Delivered", ["one", "two"], ctx)).toThrow("Invalid task transition");
		store.update(task.id, { state: "active" }, ctx);
		expect(() => store.done(task.id, "Delivered", ["one", "two"], ctx)).toThrow("Invalid task transition");
		for (const state of ["waiting-user", "blocked", "review"] as const) {
			// 阻塞要同一说法连续报三轮；先空转两轮，第三轮才允许置 blocked。
			if (state === "blocked") {
				store.update(task.id, { note: `Fixture enters ${state}` }, ctx);
				store.update(task.id, { note: `Fixture enters ${state}` }, ctx);
			}
			store.update(task.id, { state, note: `Fixture enters ${state}` }, ctx);
			store.update(task.id, { state: "active" }, ctx);
		}
		store.update(task.id, { state: "review" }, ctx);
		store.done(task.id, "Delivered ledger", ["SQLite assertion", "Reopen assertion"], ctx);
		expect(() => store.update(task.id, { title: "Changed" }, ctx)).toThrow("closed");
		const reopened = new Store(root);
		expect(reopened.get(task.id, ctx).task.state).toBe("done");
		reopened.close();
		const cancelled = store.open(content, ctx);
		store.update(cancelled.id, { state: "cancelled" }, ctx);
		expect(() => store.update(cancelled.id, { state: "active" }, ctx)).toThrow("closed");
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("done requires a deliverable and positional evidence for every revised acceptance point", async () => {
	const root = await temporary(),
		store = new Store(root),
		ctx = caller();
	try {
		const task = store.open(content, ctx);
		store.update(
			task.id,
			{ state: "active", objective: "Revised objective", acceptance: [...content.acceptance, "Third check"] },
			ctx,
		);
		store.update(task.id, { state: "review" }, ctx);
		for (const [deliverable, evidence] of [
			[" ", ["a", "b", "c"]],
			["out", ["a", "b"]],
			["out", ["a", "", "c"]],
		] as const)
			expect(() => store.done(task.id, deliverable, [...evidence], ctx)).toThrow("Done requires");
		expect(store.get(task.id, ctx).history).toHaveLength(3);
		expect(store.done(task.id, "Model's own claim, recorded without judging", ["a", "b", "c"], ctx).evidence).toEqual([
			"a",
			"b",
			"c",
		]);
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("visibility follows ownership and parent chains; cross-agent reads ongoing tasks but never writes them", async () => {
	const root = await temporary(),
		store = new Store(root),
		main = caller(),
		child = caller("child"),
		other = caller("other");
	const steward = { ...caller("steward"), capabilities: ["read", "write", "cross-agent"] };
	try {
		const parent = store.open(content, main);
		const sub = store.open({ ...content, parent: parent.id }, child);
		const nested = store.open({ ...content, parent: sub.id }, other);
		const unrelated = store.open(content, other);
		expect(store.list({ ...main, profile: "another", session: "2" }).map((t) => t.id)).toEqual([
			parent.id,
			sub.id,
			nested.id,
		]);
		expect(store.list(child).map((t) => t.id)).toEqual([sub.id, nested.id]);
		expect(() => store.get(parent.id, child)).toThrow("not found");
		expect(() => store.get(unrelated.id, main)).toThrow("not found");
		expect(store.list(steward)).toHaveLength(4);
		for (const ctx of [main, steward]) {
			expect(() => store.update(sub.id, { state: "active" }, ctx)).toThrow("not found");
			expect(() => store.done(sub.id, "out", ["a", "b"], ctx)).toThrow("not found");
		}
		store.update(sub.id, { state: "cancelled" }, child);
		expect(store.get(sub.id, main).task.state).toBe("cancelled");
		expect(() => store.get(sub.id, steward)).toThrow("not found");
		expect(store.list(steward)).toHaveLength(3);
		const preset = store.open(content, caller(null, "10"));
		expect(store.get(preset.id, caller(null, "10")).task.ownerAgent).toBeNull();
		expect(() => store.get(preset.id, caller(null, "11"))).toThrow("not found");
		expect(() => store.open({ ...content, parent: "missing" }, child)).toThrow("Parent task not found");
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("events only append, original history stays unchanged, reopening preserves content and render revisions", async () => {
	const root = await temporary(),
		store = new Store(root),
		ctx = caller();
	try {
		const task = store.open({ ...content, budget: { wallMinutes: 30, wakeups: 5 } }, ctx);
		const rows = () => {
			const db = new DatabaseSync(join(root, "tasks.sqlite"));
			try {
				return db.prepare("SELECT * FROM events ORDER BY seq").all();
			} finally {
				db.close();
			}
		};
		const initial = rows();
		const first = store.render(renderContext())!;
		expect(first).toContain(content.objective);
		for (const acceptance of content.acceptance) expect(first).toContain(acceptance);
		expect(store.render(renderContext("2"))).toBe(TURN_ONE_LINE("T1", content.title, "open", "0m", 2, "0m"));
		store.render(renderContext("2"));
		expect(store.get(task.id, ctx).task.wakeups).toBe(2);
		const reopened = new Store(root);
		expect(reopened.render(renderContext("3"))).toBe(TURN_ONE_LINE("T1", content.title, "open", "0m", 3, "0m"));
		reopened.update(task.id, { state: "active", deliverable: "Partial result", objective: "Updated objective" }, ctx);
		expect(reopened.render(renderContext("4"))).toContain("Updated objective");
		expect(reopened.render(renderContext("5"))).not.toContain("Updated objective");
		expect(reopened.render(renderContext("6", "new-session"))).toContain("Updated objective");
		expect(rows().slice(0, initial.length)).toEqual(initial);
		const result = reopened.get(task.id, ctx);
		expect(result.history[0]!.data).toMatchObject({ state: "open", objective: content.objective, wakeups: 0 });
		expect(result.task).toMatchObject({
			state: "active",
			objective: "Updated objective",
			budget: task.budget,
			wakeups: 6,
		});
		expect(result.task.lastDeliveryAt).toBeTruthy();
		reopened.update(task.id, { state: "cancelled" }, ctx);
		expect(reopened.render(renderContext("7"))).toBeUndefined();
		reopened.close();
	} finally {
		store.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("real loader tools, kernel profile selection and native turn preparation work without model calls", async () => {
	const home = await temporary();
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		const profile = {
			capabilities: ["read", "write"],
			plugins: ["tasks"],
			contexts: ["tasks-turn"],
			tools: { offer: ["tasks_*"], search: [] },
		};
		const config = {
			schema: 1 as const,
			// 完成审计要真模型；这个用例只验接线，所以显式关掉审计。
			plugins: [{ use: resolve("plugins/tasks"), config: { audit: { enabled: false } } }],
			agents: [{ id: "main", workspace: "./agents/main" }],
		};
		await mkdir(join(home, "agents/main"), { recursive: true });
		await writeFile(join(home, "yonder.yaml"), stringify(config));
		await writeFile(
			join(home, "agents/main/agent.yaml"),
			stringify({
				schema: 1,
				id: "main",
				name: "Ledger protocol test",
				owner: "person:owner",
				defaultProfile: "owner",
				profiles: { owner: profile },
				bindings: [],
			}),
		);
		kernel = await openKernel(home, { log() {} });
		const inspection = await kernel.management({ action: "inspect", agent: "main", profile: "owner" });
		expect(JSON.stringify(inspection)).toContain("tasks_open");
		const services = inspectionServices(home, config, () => {});
		const loaded = await loadPlugins(home, config, services);
		await loaded.start({
			emit: async () => {
				throw new Error("Unexpected event");
			},
			ask: async () => {
				throw new Error("Unexpected request");
			},
		});
		const tools = loaded.tools.get("tasks")!;
		expect(tools.map((t) => t.description)).toEqual([OPEN, UPDATE, DONE, LIST, GET, SHOW]);
		const call = (name: string, args: object, ctx = caller()) =>
			tools.find((t) => t.name === `tasks_${name}`)!.execute(args, ctx);
		const opened = await call("open", content);
		expect(opened.isError).not.toBe(true);
		const task = JSON.parse(opened.text) as Task;
		expect(JSON.parse((await call("list", {})).text)).toHaveLength(1);
		expect((await call("get", { id: task.id }, caller("foreign"))).isError).toBe(true);
		expect((await call("open", content, { ...caller(), signal: AbortSignal.abort() })).isError).toBe(true);
		const session = { id: "1", agent: "main", profile: "owner", cwd: home, resolved: resolveProfile(profile) };
		const options = {
			home,
			version: "test",
			locale: "en",
			timezone: "UTC",
			contexts: loaded.contexts,
			workspace: () => {
				throw new Error("No workspace reads expected");
			},
			identity: services.identity,
			models: services.models,
			setVersion: async () => {},
		};
		const input = async (id: string) =>
			prepareInput({ id: "1", version: "test" } as never, session, renderContext(id).event!, "run", options);
		expect((await input("first")).text).toContain(content.objective);
		expect((await input("second")).text).toContain(TURN_ONE_LINE("T1", content.title, "open", "0m", 2, "0m"));
		await call("update", { id: task.id, state: "active", objective: "Changed through loaded tool" });
		expect((await input("third")).text).toContain("Changed through loaded tool");
		// 批量更新共用一个事务：第二条不合法时，第一条也不落地。
		const batched = await call("update", {
			updates: [
				{ id: task.id, state: "waiting-user", note: "Waiting on the reviewer" },
				{ id: task.id, state: "active" },
			],
		});
		expect(batched.isError).not.toBe(true);
		expect(JSON.parse(batched.text).map((entry: Task) => entry.state)).toEqual(["waiting-user", "active"]);
		const rejected = await call("update", {
			updates: [
				{ id: task.id, state: "review" },
				{ id: "missing", state: "active" },
			],
		});
		expect(rejected.isError).toBe(true);
		expect(JSON.parse((await call("get", { id: task.id })).text).task.state).toBe("active");
		expect((await call("update", { updates: [{ id: task.id, state: "review" }], id: task.id })).isError).toBe(true);
		await call("update", { id: task.id, state: "review" });
		expect((await call("done", { id: task.id, deliverable: "out", evidence: ["one"] })).isError).toBe(true);
		expect((await call("done", { id: task.id, deliverable: "out", evidence: ["one", "two"] })).isError).not.toBe(true);
		expect(JSON.parse((await call("get", { id: task.id })).text).task.state).toBe("done");
		await loaded.stop();
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
});
