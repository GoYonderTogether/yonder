import { expect, it } from "vitest";
import { createViews } from "../views/index.js";
import { type HostCtx, registry } from "./methods.js";

it("exposes views with session and action authorization and streams invalidations", async () => {
	const views = createViews();
	views.register(
		"test",
		{ id: "test.one", plugin: "test", title: "Test", placement: "floating", scope: "session", actScope: "admin" },
		{
			data: () => ({ viewId: "test.one", rev: 1, content: { type: "markdown", text: "ok" } }),
			act: () => ({}),
		},
	);
	views.register(
		"test",
		{
			id: "test.hidden",
			plugin: "test",
			title: "Hidden",
			placement: "page",
			scope: "node",
			needs: { methods: ["missing.method"] },
		},
		{
			data: () => ({ viewId: "test.hidden", rev: 1, content: { type: "markdown", text: "ok" } }),
		},
	);
	const ctx = {
		principal: { id: "test", kind: "remote", transport: "gateway", scopes: ["read", "write"] },
		kernel: { views: views.api, sessions: { get: async (id: string) => ({ mode: id === "bot" ? "main" : "task" }) } },
	} as unknown as HostCtx;
	const abort = new AbortController();
	const call = (name: string, params: unknown) => registry.call(name, params, ctx, abort.signal);
	expect(await call("views.list", {})).toMatchObject({ views: [{ id: "test.one" }] });
	await expect(call("views.data", { viewId: "test.one" })).rejects.toMatchObject({ code: "invalid_params" });
	await expect(call("views.data", { viewId: "missing" })).rejects.toMatchObject({ code: "not_found" });
	await expect(call("views.data", { viewId: "test.one", session: "bot" })).rejects.toMatchObject({ code: "forbidden" });
	await expect(call("views.act", { viewId: "test.one", action: "go", session: "task" })).rejects.toMatchObject({
		code: "forbidden",
	});
	let resolve!: (value: unknown) => void;
	const event = new Promise((done) => {
		resolve = done;
	});
	expect(
		await registry.call("views.watch", { session: "task" }, ctx, abort.signal, async (value) => resolve(value)),
	).toMatchObject({ views: [{ id: "test.one" }] });
	views.invalidate("test", ["test.one", "test.hidden"]);
	expect(await event).toMatchObject({ placement: "floating", ids: ["test.one"] });
	abort.abort();
});
