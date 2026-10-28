import { afterEach, test, vi } from "vitest";

afterEach(() => vi.useRealTimers());

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as immediate } from "node:timers/promises";
import { checkRegistrations, createRegistrationCollector, readPluginManifest } from "@yonder/sdk/testing";
import plugin from "../src/index.mjs";
import { REVIEW_PRESET, REVIEW_TOOLS } from "../src/review.mjs";
import { ctx, fixture, scope } from "./helpers.mjs";

async function until(check) {
	const deadline = performance.now() + 3000;
	while (!check()) {
		assert.ok(performance.now() < deadline, "async condition timed out");
		await immediate();
	}
}
async function setup(t, extra = {}, options = {}) {
	const root = options.root ?? (await fixture(t)),
		data = join(root, "plugin-data");
	const config = options.config ?? {
		scopes: [scope(root, { learning: true, skillDir: join(root, "skills"), ...extra })],
	};
	const c = createRegistrationCollector(),
		sessions = new Map([
			["parent", { id: "parent", agent: "alpha", profile: "owner", mode: "main", opened: new Date().toISOString() }],
		]),
		events = new Map(),
		history = new Map([["parent", []]]),
		opened = [],
		submitted = [],
		aborted = [],
		closed = [],
		warnings = [];
	let serial = 0,
		abort = async () => {},
		submit = () => new Promise(() => {});
	const api = {
		...c.api,
		id: "learning",
		config,
		paths: { data },
		log: { warn: (...a) => warnings.push(a) },
		events: {
			...c.api.events,
			query: async (q) => ({ events: [...events.values()].filter((e) => !q.id || e.id === q.id) }),
		},
		sessions: {
			get: async (id) => sessions.get(id),
			open: async (req) => {
				const info = {
					id: `review-${++serial}`,
					agent: null,
					profile: req.preset,
					mode: "task",
					parent: req.parent,
					opened: new Date().toISOString(),
				};
				sessions.set(info.id, info);
				opened.push(info);
				return info;
			},
			submit: async (id, input, opts) => {
				submitted.push({ id, input: structuredClone(input), opts });
				return submit(id, input, opts);
			},
			abort: async (id) => {
				aborted.push(id);
				await abort(id);
			},
			close: async (id) => {
				closed.push(id);
				const s = sessions.get(id);
				if (s) s.closed = "closed";
			},
			transcript: async (id, range) =>
				structuredClone(
					(history.get(id) ?? []).filter((e) => e.id >= (range?.from ?? 0)).slice(0, range?.limit ?? 100),
				),
		},
	};
	await plugin.setup(api);
	assert.deepEqual(
		await checkRegistrations(
			await readPluginManifest(resolve("plugins/learning")),
			c.registrations,
			resolve("plugins/learning"),
		),
		[],
	);
	const hook = c.registrations.hooks[0];
	const emit = async (e) => {
		for (const l of c.registrations.listeners) if (l.type === e.type) await l.handler(e);
	};
	const tools = Object.fromEntries(c.registrations.tools.map((tool) => [tool.name, tool]));
	const call = async (name, args, context) => {
		const block = await hook.beforeTool({ id: "call", name, args }, context);
		if (block?.block) return { error: block.block };
		const result = await tools[name].execute(args, context);
		return { ...JSON.parse(result.text), isError: result.isError };
	};
	let eventSerial = 0,
		entrySerial = 0;
	const start = async ({
		type = "message.in",
		from = "acct:test:owner",
		text = `Verified workflow ${eventSerial + 1}`,
		loops = 1,
	} = {}) => {
		const event = { id: `in-${++eventSerial}`, type, from, conv: "conv:test:private", data: { text, kind: "dm" } };
		events.set(event.id, event);
		const context = { ...ctx("alpha", "owner", "parent"), event, events: [event] };
		const raw = [
			{ role: "user", content: text },
			{
				role: "toolResult",
				toolName: "verify",
				content: [{ type: "text", text: "Tests pass; user correction retained" }],
			},
		];
		history.get("parent").push({ id: ++entrySerial, kind: "pi.user", text, event: event.id });
		for (let i = 0; i < loops; i++) await hook.beforeRequest(raw, context);
		return { context, event, raw };
	};
	const finish = async (turn, { status = "done", final = "Verified final answer", tools: toolCalls = [] } = {}) => {
		if (final !== null)
			history.get("parent").push({ id: ++entrySerial, kind: "pi.assistant", text: final, tools: toolCalls });
		const e = {
			id: `end-${turn.event.id}`,
			type: "run.end",
			data: { session: "parent", runId: turn.event.id, inputs: [turn.event.id], status, replied: "none" },
		};
		await emit(e);
		return e;
	};
	const turn = async (options) => {
		const t = await start(options);
		await finish(t, options);
		return t;
	};
	const reviewContext = (id) => ctx(null, REVIEW_PRESET, id ?? opened.at(-1)?.id);
	const counters = async () => JSON.parse(await readFile(join(data, "learning-state.json"), "utf8")).sessions.parent;
	const tick = async (ms = 15000) => {
		vi.advanceTimersByTime(ms);
		await immediate();
	};
	if (options.clock !== false) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: 1792863000000 });
	t.onTestFinished(async () => {
		abort = async () => {};
		await c.registrations.triggers[0].stop();
	});
	return {
		root,
		data,
		config,
		api,
		hook,
		trigger: c.registrations.triggers[0],
		emit,
		tools,
		call,
		start,
		finish,
		turn,
		reviewContext,
		counters,
		opened,
		submitted,
		aborted,
		closed,
		events,
		history,
		warnings,
		tick,
		setAbort: (fn) => {
			abort = fn;
		},
		setSubmit: (fn) => {
			submit = fn;
		},
	};
}
const repeat = async (f, n = 10) => {
	for (let i = 0; i < n; i++) await f.turn();
};

test("actual registered hooks: 9/10 user turns and cycles, quiet15, merged latest clone, scoped IO and no parent pollution", async (t) => {
	const f = await setup(t);
	let admittedBeforeSubmit = false;
	f.setSubmit(async (id) => {
		const read = await f.tools[REVIEW_TOOLS[0]].execute({ target: "memory" }, f.reviewContext(id));
		admittedBeforeSubmit = !read.isError;
		return new Promise(() => {});
	});
	await repeat(f, 9);
	assert.deepEqual(
		{ ...(await f.counters()) },
		{
			memory: 9,
			skills: 9,
			inputs: Array.from({ length: 9 }, (_, i) => `in-${i + 1}`),
			runs: Array.from({ length: 9 }, (_, i) => `in-${i + 1}`),
		},
	);
	await f.tick();
	assert.equal(f.opened.length, 0);
	const tenth = await f.turn({ text: "latest user correction" });
	await f.tick(14999);
	assert.equal(f.opened.length, 0);
	const latest = await f.turn({ text: "LATEST merged correction" });
	latest.raw[0].content = "MUTATED AFTER SNAPSHOT";
	await f.tick(14999);
	assert.equal(f.opened.length, 0);
	await f.tick(1);
	await until(() => f.submitted.length === 1);
	await until(() => admittedBeforeSubmit);
	const job = f.submitted[0];
	assert.match(job.input.text, /Focus=combined/);
	assert.match(job.input.text, /LATEST merged correction/);
	assert.match(job.input.text, /Tests pass/);
	assert.doesNotMatch(job.input.text, /MUTATED AFTER/);
	assert.equal(job.opts.wait, true);
	const c = f.reviewContext(),
		m = await f.call(REVIEW_TOOLS[0], { target: "memory" }, c);
	const saved = await f.call(
		REVIEW_TOOLS[1],
		{ target: "memory", revision: m.revision, action: "add", content: "durable environment fact" },
		c,
	);
	assert.equal(saved.saved, true);
	const name = "hermes-learned-release";
	const create = await f.call(
		REVIEW_TOOLS[2],
		{
			operations: [
				{
					action: "create",
					name,
					description: "Reusable release workflow",
					body: "# Procedure\nRun tests. See references/checks.md.",
				},
				{ action: "write_file", name, file_path: "references/checks.md", file_content: "Verify actual result." },
			],
		},
		c,
	);
	assert.equal(create.saved, true, JSON.stringify(create));
	assert.match(await readFile(join(f.root, "skills", name, "references/checks.md"), "utf8"), /Verify actual/);
	assert.equal(
		(
			await f.call(
				REVIEW_TOOLS[2],
				{
					action: "patch",
					name,
					revision: create.results.find((r) => r.file_path === "SKILL.md").revision,
					old_string: "Run tests.",
					new_string: "Run checks.",
				},
				c,
			)
		).error.startsWith("fresh_read_required"),
		true,
	);
	const read = await f.call(REVIEW_TOOLS[2], { action: "read", name }, c);
	assert.ok(read.content);
	assert.equal(
		(await f.call(REVIEW_TOOLS[2], { action: "patch", name, old_string: "Run tests.", new_string: "Run checks." }, c))
			.saved,
		true,
	);
	assert.equal((await f.call("message_send", { text: "bad" }, c)).error, "review_tool_not_allowed_for_focus");
	assert.equal((await f.call("learning_refine", {}, c)).error, "review_tool_not_allowed_for_focus");
	assert.ok(f.history.get("parent").every((i) => !i.text.includes("quiet, isolated")));
	assert.equal(f.opened[0].parent, "parent");
	assert.equal(f.opened[0].agent, null);
	assert.equal((await f.counters()).memory, 0);
	assert.equal((await f.counters()).skills, 0);
	// Identity-less review ends do not recursively count or open another job.
	await f.emit({ type: "run.end", data: { session: c.session, inputs: [], runId: "review-end", status: "done" } });
	await f.tick();
	assert.equal(f.opened.length, 1);
	assert.match(
		(await f.tools[REVIEW_TOOLS[1]].execute({ target: "memory" }, c)).text,
		/review_grant_required_or_expired/,
	);
	assert.ok(tenth.event.id);
});

test("memory-only / skills-only focus are hard dispatch and wrapper boundaries; skill threshold is model cycles", async (t) => {
	const memory = await setup(t, { learning: false });
	await repeat(memory);
	await memory.tick();
	await until(() => memory.submitted.length === 1);
	assert.match(memory.submitted[0].input.text, /Focus=memory/);
	assert.equal(
		(await memory.call(REVIEW_TOOLS[2], { action: "read", name: "hermes-learned-x" }, memory.reviewContext())).error,
		"review_tool_not_allowed_for_focus",
	);
	const direct = await memory.tools[REVIEW_TOOLS[2]].execute(
		{ action: "read", name: "hermes-learned-x" },
		memory.reviewContext(),
	);
	assert.match(direct.text, /review_focus_denied/);
});
test("skills-only ten iterations in one real user turn, no memory access", async (t) => {
	const f = await setup(t, { memory: false, user: false });
	const a = await f.start({ loops: 9 });
	await f.finish(a);
	await f.tick();
	assert.equal(f.opened.length, 0);
	await f.turn();
	await f.tick();
	await until(() => f.submitted.length === 1);
	assert.match(f.submitted[0].input.text, /Focus=skills/);
	assert.equal(
		(await f.call(REVIEW_TOOLS[0], { target: "memory" }, f.reviewContext())).error,
		"review_tool_not_allowed_for_focus",
	);
});

test("real mutation dispatch resets even on failure; counters and run/input dedup restore after setup restart", async (t) => {
	const f = await setup(t);
	await repeat(f, 9);
	const a = await f.start();
	const mem = await f.call(
		"learning_memory_edit",
		{ target: "memory", revision: "0".repeat(64), action: "add", content: "bad" },
		a.context,
	);
	assert.equal(mem.error, "conflict_stale_revision");
	const skill = await f.call(
		"learning_skill_store",
		{ action: "create", name: "foreign", description: "bad", body: "bad" },
		a.context,
	);
	assert.equal(skill.error, "private_skill_name_required");
	const end = await f.finish(a);
	assert.equal((await f.counters()).memory, 0);
	assert.equal((await f.counters()).skills, 0);
	await f.tick();
	assert.equal(f.opened.length, 0);
	const restarted = await setup(t, {}, { root: f.root, clock: false });
	restarted.events.set(a.event.id, a.event);
	await restarted.emit(end);
	assert.deepEqual(await restarted.counters(), await f.counters());
	assert.equal(
		(await restarted.tools[REVIEW_TOOLS[1]].execute({ target: "memory" }, ctx(null, REVIEW_PRESET, "old-running")))
			.isError,
		true,
	);
});

test("ordinary task / same named preset cannot acquire review authority; no recursive or synthetic-input counting", async (t) => {
	const f = await setup(t);
	f.api.sessions.get = async (id) =>
		id === "parent"
			? { id, agent: "alpha", profile: "owner", mode: "main" }
			: { id, agent: null, profile: REVIEW_PRESET, mode: "task", parent: "parent" };
	const child = ctx(null, REVIEW_PRESET, "ordinary-child");
	const controller = new AbortController();
	child.signal = controller.signal;
	f.setAbort(async () => controller.abort());
	await assert.rejects(f.hook.beforeRequest([], child), /review_grant_required/);
	child.signal = new AbortController().signal;
	f.setAbort(async () => {});
	for (const name of REVIEW_TOOLS)
		assert.match(
			(await f.tools[name].execute({ target: "memory", action: "read", name: "hermes-learned-x" }, child)).text,
			/review_grant_required/,
		);
	for (const type of ["session.input", "runtime.continuation", "runtime.tool-result"]) await f.turn({ type });
	for (let i = 0; i < 10; i++) await f.turn({ from: "acct:agent:hermes" });
	assert.equal((await f.counters()).memory, 0);
	assert.equal((await f.counters()).skills, 0);
	await f.tick();
	assert.equal(f.opened.length, 0);
});

test("final response and interruption gate independently of status=done; error+actual final is reviewable", async (t) => {
	const f = await setup(t, { learning: false });
	await repeat(f, 9);
	const noFinal = await f.start();
	await f.finish(noFinal, { final: null });
	await f.tick();
	assert.equal(f.opened.length, 0);
	const interrupted = await f.start();
	await f.finish(interrupted, { status: "aborted" });
	await f.tick();
	assert.equal(f.opened.length, 0);
	await f.turn({ status: "error", final: "Actual final despite error" });
	await f.tick();
	await until(() => f.submitted.length === 1);
	assert.match(f.submitted[0].input.text, /Actual final despite error/);
});

test("foreground preemption revokes first, waits at most2s, stale writes fail, auto requeues latest at most3 times", async (t) => {
	const f = await setup(t);
	await repeat(f);
	await f.tick();
	await until(() => f.submitted.length === 1);
	let release;
	f.setAbort(
		() =>
			new Promise((r) => {
				release = r;
			}),
	);
	const old = f.reviewContext();
	const starting = f.start({ text: "new foreground" });
	await until(() => f.aborted.length === 1);
	const refused = await f.tools[REVIEW_TOOLS[1]].execute({ target: "memory", action: "add", content: "stale" }, old);
	assert.match(refused.text, /review_grant_required_or_expired/);
	let admitted = false;
	starting.then(() => {
		admitted = true;
	});
	await f.tick(1999);
	assert.equal(admitted, false);
	await f.tick(1);
	const fresh = await starting;
	release();
	f.setAbort(async () => {});
	await f.finish(fresh);
	await f.tick();
	await until(() => f.submitted.length === 2);
	for (let attempt = 2; attempt <= 3; attempt++) {
		await f.turn();
		await f.tick();
		await until(() => f.submitted.length === attempt + 1);
	}
	await f.turn();
	await f.tick();
	assert.equal(f.submitted.length, 4, "initial + exactly three requeues");
});

test("30min pending age-out and late run.end generation never clone the next foreground turn", async (t) => {
	const f = await setup(t);
	await repeat(f);
	vi.setSystemTime(Date.now() + 30 * 60 * 1000);
	await f.tick();
	await immediate();
	assert.equal(f.opened.length, 0);
	// A delayed end after a new beforeRequest cannot capture that newer material.
	await repeat(f, 9);
	const old = await f.start({ text: "OLD" });
	const next = await f.start({ text: "NEXT" });
	await f.finish(old);
	await f.tick();
	assert.equal(f.opened.length, 0);
	await f.finish(next);
	await f.tick();
	await until(() => f.submitted.length === 1);
	assert.match(f.submitted[0].input.text, /NEXT/);
});

test("close/off revoke grants before abort and prevent new jobs; restart never revives running grant", async (t) => {
	const f = await setup(t);
	await repeat(f);
	await f.tick();
	await until(() => f.submitted.length === 1);
	const c = f.reviewContext();
	await f.emit({ type: "session.close", data: { session: "parent" } });
	assert.equal((await f.tools[REVIEW_TOOLS[0]].execute({ target: "memory" }, c)).isError, true);
	assert.ok(f.aborted.includes(c.session));
	assert.ok(f.closed.includes(c.session));
	await f.turn();
	await f.tick();
	assert.equal(f.submitted.length, 1);
	const g = await setup(t, {}, { root: f.root, clock: false });
	assert.equal((await g.tools[REVIEW_TOOLS[0]].execute({ target: "memory" }, c)).isError, true);
	g.config.enabled = false;
	const before = await readFile(join(g.data, "learning-state.json"), "utf8");
	await g.turn();
	assert.equal(await readFile(join(g.data, "learning-state.json"), "utf8"), before);
});

test("unattended destructive memory is pending; explicit /refine is trusted attended and does not requeue", async (t) => {
	const f = await setup(t);
	await repeat(f);
	await f.tick();
	await until(() => f.submitted.length === 1);
	const c = f.reviewContext(),
		m = await f.call(REVIEW_TOOLS[0], { target: "memory" }, c);
	const staged = await f.call(
		REVIEW_TOOLS[1],
		{ target: "memory", action: "patch", revision: m.revision, old_text: "synthetic note", content: "revised fact" },
		c,
	);
	assert.equal(staged.staged, true);
	assert.equal(staged.saved, false);
	const front = ctx("alpha", "owner", "parent");
	const pending = await f.call("learning_memory_pending", { action: "list" }, front);
	assert.equal(pending[0].id, staged.pending_id);
	const record = await f.call("learning_memory_pending", { action: "read", id: staged.pending_id }, front);
	assert.equal(record.target, "memory");
	assert.equal(
		(await f.call("learning_memory_pending", { action: "apply", id: staged.pending_id }, front)).saved,
		true,
	);
	const no = await f.turn({ text: "normal work" });
	assert.equal((await f.call("learning_refine", {}, no.context)).error, "refine_requires_user_command");
	const explicit = await f.start({ text: "/refine memory" });
	const queued = await f.call("learning_refine", { focus: "memory" }, explicit.context);
	assert.equal(queued.attended, true);
	await f.finish(explicit);
	await f.tick();
	await until(() => f.submitted.length === 2);
	const r = f.reviewContext(),
		read = await f.call(REVIEW_TOOLS[0], { target: "memory" }, r);
	const saved = await f.call(
		REVIEW_TOOLS[1],
		{ target: "memory", action: "patch", revision: read.revision, old_text: "revised fact", content: "attended fact" },
		r,
	);
	assert.equal(saved.saved, true);
	assert.equal(saved.staged, undefined);
	await f.turn();
	await f.tick();
	assert.equal(f.submitted.length, 2, "explicit review cannot requeue on interruption");
});

test("review hard loop ceiling16 and detailed error fields survive wrapper serialization", async (t) => {
	const f = await setup(t);
	await repeat(f);
	await f.tick();
	await until(() => f.submitted.length === 1);
	const r = f.reviewContext();
	const controller = new AbortController();
	r.signal = controller.signal;
	f.setAbort(async () => controller.abort());
	for (let i = 0; i < 16; i++) await f.hook.beforeRequest([], r);
	await assert.rejects(f.hook.beforeRequest([], r), /review_iteration_limit/);
	f.setAbort(async () => {});
	const a = await f.start(),
		m = await f.call("learning_memory_read", { target: "memory" }, a.context);
	for (let i = 0; i < 4; i++) {
		const bad = await f.call(
			"learning_memory_edit",
			{ target: "memory", action: "add", revision: m.revision, content: "X".repeat(2300) },
			a.context,
		);
		assert.ok(bad.used !== undefined);
		assert.ok(bad.current_entries);
		if (i === 3) {
			assert.equal(bad.done, true);
			assert.equal(bad.success, false);
			assert.match(bad.error, /consolidation_retry_cap/);
		}
	}
});

test("registered wrappers recheck the revoked grant immediately before memory commit, preserving disk", async (t) => {
	const f = await setup(t);
	await repeat(f);
	await f.tick();
	await until(() => f.submitted.length === 1);
	const r = f.reviewContext(),
		m = await f.call(REVIEW_TOOLS[0], { target: "memory" }, r),
		original = await readFile(join(f.root, "memories/MEMORY.md"), "utf8");
	const get = f.api.sessions.get;
	let calls = 0,
		release,
		atCommit = false;
	f.api.sessions.get = async (id) => {
		if (id === "parent" && ++calls === 3) {
			atCommit = true;
			await new Promise((resolve) => {
				release = resolve;
			});
		}
		return get(id);
	};
	const writing = f.tools[REVIEW_TOOLS[1]].execute(
		{ target: "memory", action: "add", revision: m.revision, content: "must not commit" },
		r,
	);
	await until(() => atCommit);
	const next = await f.start({ text: "foreground revokes admission" });
	release();
	const result = JSON.parse((await writing).text);
	assert.equal(result.error, "review_inactive");
	assert.equal(await readFile(join(f.root, "memories/MEMORY.md"), "utf8"), original);
	await f.finish(next);
});

test("trigger.stop revokes active grants without messages or restarting any runtime", async (t) => {
	const f = await setup(t);
	await repeat(f);
	await f.tick();
	await until(() => f.submitted.length === 1);
	const r = f.reviewContext();
	await f.trigger.stop();
	// No api.messages facility is provided in this fixture: any send would fail the test.
	assert.ok(f.aborted.includes(r.session));
	assert.equal((await f.tools[REVIEW_TOOLS[1]].execute({ target: "memory" }, r)).isError, true);
});
