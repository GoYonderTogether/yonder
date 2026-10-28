import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSettledEv, ViewDecl, ViewProvider } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, it } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { type KernelServices, loadPlugins } from "../plugins/index.js";
import { openDatabase } from "../runtime/db.js";
import { Runtime } from "../runtime/index.js";
import { createStore } from "../store/index.js";
import { createViews } from "./index.js";

const declaration = (id: string, placement: ViewDecl["placement"] = "rail"): ViewDecl => ({
	id,
	plugin: id.split(".")[0]!,
	title: id,
	placement,
	scope: "session",
});
const provider = (viewId: string): ViewProvider => ({
	data: (session) => ({ viewId, rev: 0, content: { type: "markdown", text: session ?? "" } }),
	act: (action, input, session) => ({
		content: { type: "markdown", text: JSON.stringify({ action, input, session }) },
	}),
});

it("collects views, rejects conflicts and plugin impersonation, filters placement and passes session", async () => {
	const { registrations, api } = createRegistrationCollector();
	const decl = declaration("tasks.todo");
	api.views.register(decl, provider(decl.id));
	expect(registrations.views.map((value) => value.decl.id)).toEqual([decl.id]);
	const views = createViews();
	views.register("tasks", decl, provider(decl.id));
	expect(() => views.register("tasks", decl, provider(decl.id))).toThrow("contribution conflict");
	expect(() => views.register("other", decl, provider(decl.id))).toThrow("declaring plugin");
	expect(() =>
		views.register("tasks", { ...decl, id: "tasks.read", actScope: "read" }, provider("tasks.read")),
	).toThrow("write scope");
	views.register("other", declaration("other.page", "page"), provider("other.page"));
	views.register("tasks", declaration("tasks.spoof"), provider("other.page"));
	await expect(views.data("tasks.spoof", "1")).rejects.toThrow("another view");
	expect(views.list({ placement: "page", session: "1" })).toEqual([declaration("other.page", "page")]);
	await expect(views.data(decl.id)).rejects.toMatchObject({ code: "invalid_params" });
	expect((await views.data(decl.id, "1")).content).toEqual({ type: "markdown", text: "1" });
	await expect(views.act("tasks.other", "go", undefined, "1")).rejects.toMatchObject({ code: "not_found" });
	expect((await views.act(decl.id, "go", { a: 1 }, "1")).content).toEqual({
		type: "markdown",
		text: '{"action":"go","input":{"a":1},"session":"1"}',
	});
});

it("rejects invalid actions, JSON inputs and UTF-8 overflow without calling act", async () => {
	const views = createViews();
	let calls = 0;
	views.register(
		"tasks",
		{ ...declaration("tasks.todo"), actions: ["go"] },
		{
			...provider("tasks.todo"),
			act: () => {
				calls++;
				return {};
			},
		},
	);
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	for (const [action, input] of [
		["", undefined],
		["Go", {}],
		["g".repeat(65), {}],
		["other", {}],
		["go", []],
		["go", "text"],
		["go", 1],
		["go", new Date()],
		["go", { nested: new Date() }],
		["go", { text: "a".repeat(16374) }],
		["go", { text: "中".repeat(6000) }],
		["go", cyclic],
		["go", { n: 1n }],
		["go", { fn: () => {} }],
	]) {
		await expect(views.act("tasks.todo", action as string, input, "1")).rejects.toMatchObject({
			code: "invalid_params",
		});
	}
	expect(calls).toBe(0);
	for (const input of [undefined, null, {}, { text: "a".repeat(16373) }])
		await views.act("tasks.todo", "go", input, "1");
	expect(calls).toBe(4);
});

it("coalesces invalidations per placement, scopes ids to the plugin and closes watch", async () => {
	const views = createViews();
	for (const [id, placement] of [
		["tasks.one", "rail"],
		["tasks.two", "rail"],
		["tasks.three", "page"],
		["other.one", "rail"],
	] as const)
		views.register(id.split(".")[0]!, declaration(id, placement), provider(id));
	const all = views.watch({ session: "1" });
	const rail = views.watch({ placement: "rail" });
	expect(() => views.invalidate("other", ["tasks.one"])).toThrow();
	views.invalidate("tasks", ["tasks.one"], 2);
	views.invalidate("tasks", undefined, 3);
	expect((await all.next()).value).toEqual({
		placement: "rail",
		ids: ["tasks.one", "tasks.two"],
		badge: { "tasks.one": 3, "tasks.two": 3 },
	});
	expect((await all.next()).value).toEqual({ placement: "page", ids: ["tasks.three"], badge: { "tasks.three": 3 } });
	expect((await rail.next()).value?.ids).toEqual(["tasks.one", "tasks.two"]);
	const pending = rail.next();
	await rail.return?.();
	expect((await pending).done).toBe(true);
	await all.return?.();
});

it("uses the plugin loader claim/register boundary for conflicts and namespace checks", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-views-plugin-"));
	try {
		for (const [name, duplicate, foreign] of [
			["duplicate", true, false],
			["foreign", false, true],
		] as const) {
			const dir = join(home, name);
			await mkdir(dir);
			await writeFile(
				join(dir, "package.json"),
				JSON.stringify({
					name,
					version: "1.0.0",
					type: "module",
					yonder: { apiVersion: 1, id: name, entry: "index.mjs", contributes: { views: [`${name}.one`] } },
				}),
			);
			await writeFile(
				join(dir, "index.mjs"),
				`export default { setup(ctx) {
    const decl = { id: '${foreign ? "other" : name}.one', plugin: '${name}', title: 'Contract check', placement: 'rail', scope: 'node' };
    const provider = { data: () => ({ viewId: decl.id, rev: 0, content: { type: 'kv', rows: [] } }) };
    ctx.views.register(decl, provider); ${duplicate ? "ctx.views.register(decl, provider);" : ""}
   } };`,
			);
			await expect(
				loadPlugins(home, { schema: 1, plugins: [{ use: dir }] }, { log: console } as unknown as KernelServices),
			).rejects.toThrow(duplicate ? "contribution conflict" : "declaring plugin");
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

it("records session.settled once for a native failed run, including recovery and restart", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-views-settled-"));
	const events: SessionSettledEv[] = [];
	let runtime: Runtime | undefined;
	let store: Awaited<ReturnType<typeof createStore>>;
	const open = async () => {
		const db = await openDatabase(join(home, "state.db"));
		store = await createStore(db);
		return Runtime.open({
			home,
			db,
			config: { schema: 1, retry: { maxRetries: 0 } },
			resolveSession: async () => ({ agent: null, profile: "default", cwd: home, resolved: resolveProfile({}) }),
			settled: async (session, runId) => Boolean(await store.events.runEnd(session, runId)),
			onRun: async (session, run) => {
				await store.events.record({ type: "run.end", data: { session, runId: run.runId, status: run.status } });
			},
			onSessionSettled: async (data) => {
				await store.events.record({ type: "session.settled", data });
				events.push(data);
			},
		});
	};
	try {
		runtime = await open();
		const id = await runtime.create({ agent: null, profile: "default", cwd: home });
		const run = await runtime.submit(id, { text: "Verify missing-model failure lifecycle." });
		expect(run.status).toBe("error");
		await expect.poll(() => events).toEqual([{ session: id, status: "error" }]);
		await runtime.recover();
		expect(events).toHaveLength(1);
		await runtime.close();
		runtime = undefined;
		runtime = await open();
		await runtime.recover();
		expect(events).toHaveLength(1);
		expect((await store!.events.query({ type: "session.settled" })).events.map((event) => event.data)).toEqual([
			{ session: id, status: "error" },
		]);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});

it("a loaded provider invalidates through its setup context closure", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-views-closure-"));
	try {
		await writeFile(
			join(home, "package.json"),
			JSON.stringify({
				name: "counter",
				version: "1.0.0",
				type: "module",
				yonder: { apiVersion: 1, id: "counter", entry: "index.mjs", contributes: { views: ["counter.value"] } },
			}),
		);
		await writeFile(
			join(home, "index.mjs"),
			`export default { setup(ctx) {
   let value = 0;
   ctx.views.register({ id: 'counter.value', plugin: 'counter', title: 'Counter', placement: 'floating', scope: 'node' }, {
    data: () => ({ viewId: 'counter.value', rev: value, content: { type: 'kv', rows: [{ k: 'value', v: String(value) }] } }),
    act: () => { value++; ctx.invalidate(undefined, value); return {}; }
   });
  } };`,
		);
		const loaded = await loadPlugins(home, { schema: 1, plugins: [{ use: home }] }, {
			log: console,
		} as unknown as KernelServices);
		const watch = loaded.views.watch();
		await loaded.views.act("counter.value", "increment");
		expect((await watch.next()).value).toEqual({
			placement: "floating",
			ids: ["counter.value"],
			badge: { "counter.value": 1 },
		});
		expect((await loaded.views.data("counter.value")).rev).toBe(1);
		await watch.return?.();
		await loaded.stop();
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
