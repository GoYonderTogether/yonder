import { mkdtemp, rm } from "node:fs/promises";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { aggregateExecution } from "./activity.js";
import { openDatabase } from "./db.js";
import { cid, SessionDoc } from "./docs.js";
import { Runtime } from "./index.js";

// Real Runtime.submit -> prompt section fault -> native scheduler settlement and receipt.
// No provider or model response is simulated, and the failure occurs before any model request.
test("terminal native failure persists; write-only admission and historical receipt replay cannot clear or backfill it", async () => {
	const home = await mkdtemp("/tmp/yonder-activity-");
	const options = {
		home,
		config: { schema: 1 as const, retry: { maxRetries: 0 } },
		sections: async (): Promise<string[]> => {
			throw new Error("private section failure marker");
		},
		resolveSession: async () => ({ agent: null, profile: "activity", cwd: home, resolved: resolveProfile({}) }),
	};
	const open = () => openDatabase(`${home}/state.db`).then((db) => Runtime.open({ ...options, db }));
	let runtime = await open();
	try {
		const session = await runtime.create({ agent: null, profile: "activity", cwd: home });
		const run = await runtime.submit(session, { text: "Check native prompt-fault settlement." });
		expect(run.status).toBe("error");
		const failed = await runtime.activity(session);
		expect(failed).toMatchObject({
			state: "idle",
			detail: "执行受阻",
			execution: { phase: "blocked", issue: { code: "model_error", runId: run.runId, since: expect.any(Number) } },
		});
		expect(Object.keys(failed.execution.issue!).sort()).toEqual(["code", "runId", "since"]);
		expect(JSON.stringify(failed.execution)).not.toContain(run.reason);
		await runtime.submit(session, { text: "A non-waking write must not clear the issue.", wake: "write" });
		expect((await runtime.activity(session)).execution).toEqual(failed.execution);
		await runtime.close();
		runtime = await open();
		await runtime.recover();
		expect((await runtime.activity(session)).execution).toEqual(failed.execution);
		await runtime.abort(session);
		expect((await runtime.activity(session)).execution).toEqual({ phase: "idle" });
		await runtime.close();
		runtime = await open();
		await runtime.recover(); // deliberately replays historical receipt through existing observer
		expect((await runtime.activity(session)).execution).toEqual({ phase: "idle" });

		// An upgraded database with no activity cursor must not adopt old failed receipts.
		const internal = runtime as unknown as { harness: Harness };
		await internal.harness.commit(async (tx) => {
			const state = await tx.doc(SessionDoc, cid(session));
			delete (state as Partial<typeof state>).activityRunId;
			delete (state as Partial<typeof state>).activityIssue;
		}, C);
		await runtime.recover();
		expect((await runtime.activity(session)).execution).toEqual({ phase: "idle" });
	} finally {
		await runtime.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("actual next run start clears old issue before the model request", async () => {
	const home = await mkdtemp("/tmp/yonder-activity-start-");
	let hold = false;
	let entered!: () => void;
	let release!: () => void;
	const gate = new Promise<void>((done) => {
		release = done;
	});
	const prepared = new Promise<void>((done) => {
		entered = done;
	});
	const runtime = await Runtime.open({
		home,
		db: await openDatabase(`${home}/state.db`),
		config: { schema: 1, retry: { maxRetries: 0 } },
		resolveSession: async () => ({ agent: null, profile: "activity", cwd: home, resolved: resolveProfile({}) }),
		sections: async () => {
			if (hold) {
				entered();
				await gate;
			}
			throw new Error("private section failure marker");
		},
	});
	try {
		const session = await runtime.create({ agent: null, profile: "activity", cwd: home });
		await runtime.submit(session, { text: "Fail at native prompt preparation." });
		expect((await runtime.activity(session)).execution.phase).toBe("blocked");
		hold = true;
		const pending = runtime.submit(session, { text: "Begin a genuinely new run." });
		await prepared;
		expect((await runtime.activity(session)).execution).toMatchObject({ phase: "running", runId: expect.any(String) });
		expect((await runtime.activity(session)).execution.issue).toBeUndefined();
		release();
		await pending;
	} finally {
		release();
		await runtime.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("normal parallel execution wins over retry, current input wait wins over settled issue", () => {
	const issue = { phase: "blocked" as const, issue: { code: "model_error", since: 1, runId: "1" } };
	const retry = { phase: "retrying" as const, runId: "2", retryAt: 100 };
	const running = { phase: "running" as const, runId: "3" };
	expect(aggregateExecution([issue, retry, running])).toEqual(running);
	expect(aggregateExecution([running, retry, issue])).toEqual(running);
	expect(aggregateExecution([issue, retry])).toEqual(retry);
	expect(aggregateExecution([issue, { phase: "waiting-input" }])).toEqual({ phase: "waiting-input" });
});

// This calls the production terminal activity endpoint over real Runtime + Store.
// Other terminal dependencies are not used by activity(), so no model or service is mocked.
test("terminal activity includes open blocked sessions, preserves legacy idle, and excludes closed or identity-less sessions", async () => {
	const { terminalApi } = await import("../kernel/terminal.js");
	const { createStore } = await import("../store/index.js");
	const { parseAgentConfig } = await import("../config/index.js");
	const home = await mkdtemp("/tmp/yonder-activity-terminal-");
	const db = await openDatabase(`${home}/state.db`);
	const store = await createStore(db);
	let hold = false;
	let release!: () => void;
	const gate = new Promise<void>((done) => {
		release = done;
	});
	const runtime = await Runtime.open({
		home,
		db,
		config: { schema: 1, retry: { maxRetries: 0 } },
		resolveSession: async () => ({ agent: "main", profile: "activity", cwd: home, resolved: resolveProfile({}) }),
		sections: async () => {
			if (hold) await gate;
			throw new Error("private section failure marker");
		},
	});
	const agent = parseAgentConfig(
		"schema: 1\nid: main\nname: Main\nowner: person:owner\ndefaultProfile: owner\nprofiles:\n  owner: {}\nbindings: []\n",
	);
	const terminal = terminalApi({
		agents: new Map([["main", agent]]),
		store,
		sessions: {},
		runtime: () => runtime,
	} as Parameters<typeof terminalApi>[0]);
	const create = async (identity: string | null) => {
		const id = await runtime.create({ agent: identity, profile: "activity", cwd: home });
		await store.sessions.put({
			id,
			agent: identity,
			profile: "activity",
			mode: "persistent",
			key: id,
			version: "activity-test",
			opened: new Date().toISOString(),
		});
		return id;
	};
	try {
		const failed = await create("main");
		await runtime.submit(failed, { text: "Verify failure via terminal projection." });
		expect((await terminal.activity())[0]).toMatchObject({
			state: "idle",
			execution: { phase: "blocked" },
			tasks: [{ id: failed, state: "idle", execution: { phase: "blocked" } }],
		});
		const anonymous = await create(null);
		await runtime.submit(anonymous, { text: "An identity-less session cannot be attributed by cwd or preset." });
		expect((await terminal.activity())[0]!.tasks.map((task) => task.id)).toEqual([failed]);
		hold = true;
		const peer = await create("main");
		const running = runtime.submit(peer, { text: "Hold a second real session in request preparation." });
		await expect.poll(async () => (await runtime.activity(peer)).execution.phase).toBe("running");
		expect((await terminal.activity())[0]).toMatchObject({
			state: "running",
			execution: { phase: "running", runId: expect.any(String) },
		});
		release();
		await running;
		await store.sessions.close(failed);
		await store.sessions.close(peer);
		expect((await terminal.activity())[0]).toMatchObject({ state: "idle", execution: { phase: "idle" }, tasks: [] });
	} finally {
		release();
		await runtime.close();
		await rm(home, { recursive: true, force: true });
	}
});
