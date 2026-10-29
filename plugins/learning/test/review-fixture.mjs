import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as immediate } from "node:timers/promises";
import { checkRegistrations, createRegistrationCollector, readPluginManifest } from "@yonder/sdk/testing";
import { vi } from "vitest";
import plugin from "../src/index.mjs";
import { REVIEW_PRESET } from "../src/review.mjs";
import { ctx, fixture, scope } from "./helpers.mjs";

export async function until(check) {
	const deadline = performance.now() + 10000;
	while (!check()) {
		assert.ok(performance.now() < deadline, "async condition timed out");
		await immediate();
	}
}
export async function setup(t, extra = {}, options = {}) {
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
		history
			.get("parent")
			.push({ id: ++entrySerial, kind: "pi.tool-result", text: "Tests pass; user correction retained" });
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
		view: c.registrations.views[0].provider,
		tick,
		setAbort: (fn) => {
			abort = fn;
		},
		setSubmit: (fn) => {
			submit = fn;
		},
	};
}
export const repeat = async (f, n = 10) => {
	for (let i = 0; i < n; i++) await f.turn();
};
