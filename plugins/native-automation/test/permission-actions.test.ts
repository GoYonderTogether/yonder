import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, Tool, ToolContext, YEvent } from "@yonder/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ desktop: vi.fn(), stopChildren: vi.fn() }));
vi.mock("../src/desktop.js", () => transport);

import plugin from "../src/index.js";

const ownerInput: YEvent = {
	id: "owner-input",
	ts: "2026-10-24T14:00:00Z",
	type: "message.in",
	from: "acct:test:owner",
	data: {},
};
let data: string;
let tool: Tool;
let ctx: ToolContext;
let relation: ReturnType<typeof vi.fn>;
let query: ReturnType<typeof vi.fn>;
let persisted: Map<string, YEvent>;
beforeEach(async () => {
	vi.clearAllMocks();
	persisted = new Map();
	query = vi.fn(async ({ id }: { id: string }) => ({ events: persisted.has(id) ? [persisted.get(id)] : [] }));
	data = await mkdtemp(join(tmpdir(), "yonder-permission-unit-"));
	relation = vi.fn(async (_agent: string, account: string) => (account === ownerInput.from ? "owner" : "stranger"));
	ctx = {
		agent: "main",
		profile: "standard",
		session: "permission-unit",
		env: { id: "node:local" } as ToolContext["env"],
		capabilities: ["exec", "read", "write", "message"],
		event: ownerInput,
		events: [ownerInput],
		signal: new AbortController().signal,
	};
	transport.desktop.mockResolvedValue({ outcome: "timeout", exitCode: 1, permission: { state: "requested" } });
	await plugin.setup({
		paths: { data },
		identity: { relation },
		tools: {
			register: (registered: Tool) => {
				if (registered.name === "native-automation_desktop") tool = registered;
			},
		},
		events: { on() {}, query },
		triggers: { register() {} },
	} as unknown as PluginAPI);
});
afterEach(async () => {
	await rm(data, { recursive: true, force: true });
});

describe("explicit permission actions, no live Helper", () => {
	it.each(["permission-request", "permission-guide", "permission-watch"])("owner can reach %s", async (action) => {
		const args = { action, kind: "accessibility" };
		const reply = await tool.execute(args, ctx);
		expect(reply.isError).toBeUndefined();
		expect(relation).toHaveBeenCalledWith("main", ownerInput.from);
		expect(transport.desktop).toHaveBeenCalledWith(args, ctx.signal, ctx.session);
		// A successful initiation/observation transport does not claim a grant.
		expect(JSON.parse(reply.text).result).toEqual({
			outcome: "timeout",
			exitCode: 1,
			permission: { state: "requested" },
		});
	});
	it.each([
		"accessibility",
		"screen-recording",
		"input-monitoring",
		"camera",
		"microphone",
		"notifications",
		"automation",
		"full-disk-access",
		"files-and-folders",
	])("valid kind %s", async (kind) => {
		expect((await tool.execute({ action: "permission-request", kind }, ctx)).isError).toBeUndefined();
	});
	it.each([
		{ kind: "all" },
		{ kind: "TCC" },
		{},
		{ kind: ["camera", "microphone"] },
		{ kind: "camera", owner: true },
		{ kind: "camera", from: "acct:test:owner" },
		{ kind: "camera", timeout: 0 },
		{ kind: "camera", timeout: -1 },
		{ kind: "camera", timeout: 601 },
		{ kind: "camera", timeout: Number.NaN },
		{ kind: "camera", timeout: Number.POSITIVE_INFINITY },
		{ kind: "camera", timeout: "1" },
	])("invalid parameters rejected before transport: %j", async (fields) => {
		expect((await tool.execute({ action: "permission-guide", ...fields }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it.each([0.001, 1, 600])("bounded timeout %s", async (timeout) => {
		expect((await tool.execute({ action: "permission-watch", kind: "camera", timeout }, ctx)).isError).toBeUndefined();
	});
	it("request does not pretend to implement a guide/watch timeout", async () => {
		expect((await tool.execute({ action: "permission-request", kind: "camera", timeout: 1 }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it.each(["known", "stranger"])("%s relation cannot initiate", async (value) => {
		relation.mockResolvedValue(value);
		for (const action of ["permission-request", "permission-guide", "permission-watch"]) {
			expect((await tool.execute({ action, kind: "camera" }, ctx)).isError).toBe(true);
		}
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it.each([
		{ agent: null },
		{ event: undefined, events: [] },
		{
			events: [
				{ ...ownerInput, type: "agent.ask", from: "agent:main", data: { sources: [ownerInput.id], owner: true } },
			],
		},
		{ events: [{ ...ownerInput, type: "runtime.continuation" }] },
		{ events: [{ ...ownerInput, from: "person:owner" }] },
		{ events: [ownerInput, { ...ownerInput, from: "acct:test:guest" }] },
	])("non-owner actual run sources fail closed: %j", async (patch) => {
		Object.assign(ctx, patch);
		expect((await tool.execute({ action: "permission-guide", kind: "camera" }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it("an internal agent source cannot become human authority even if linked to owner", async () => {
		relation.mockResolvedValue("owner");
		ctx.events = [
			{
				...ownerInput,
				from: "acct:agent:main",
				conv: "conv:agent:main",
				data: { kind: "agent", sources: [ownerInput.id] },
			},
		];
		expect((await tool.execute({ action: "permission-request", kind: "camera" }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it("missing optional events uses the actual event, not historical messages", async () => {
		delete ctx.events;
		expect((await tool.execute({ action: "permission-watch", kind: "camera" }, ctx)).isError).toBeUndefined();
	});
	it("identity lookup errors fail closed", async () => {
		relation.mockRejectedValue(new Error("identity unavailable"));
		expect((await tool.execute({ action: "permission-request", kind: "camera" }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it("a direct owner session input uses the same identity check", async () => {
		ctx.events = [{ ...ownerInput, type: "session.input" }];
		expect((await tool.execute({ action: "permission-watch", kind: "camera" }, ctx)).isError).toBeUndefined();
	});
	function chain(depth = 2): YEvent[] {
		const route = { agent: ctx.agent!, binding: null, session: ctx.session };
		const events: YEvent[] = [{ ...ownerInput, conv: "conv:test:owner", routes: [route] }];
		for (let i = 1; i <= depth; i++)
			events.push({
				id: `causal-${i}`,
				ts: ownerInput.ts,
				type: i % 2 ? "runtime.tool-result" : "runtime.continuation",
				parent: events[i - 1]!.id,
				conv: events[0]!.conv,
				routes: [route],
				data: { session: ctx.session },
			});
		for (const event of events) persisted.set(event.id, event);
		ctx.event = events.at(-1)!;
		ctx.events = [ctx.event];
		return events;
	}
	it.each([1, 2, 64])("owner causal chain of %s hops reaches mocked transport", async (depth) => {
		const events = chain(depth);
		expect((await tool.execute({ action: "permission-watch", kind: "camera" }, ctx)).isError).toBeUndefined();
		expect(query).toHaveBeenCalledTimes(depth);
		expect(query).toHaveBeenCalledWith({ id: events[0]!.id, limit: 1 });
		expect(transport.desktop).toHaveBeenCalledTimes(1);
	});
	it.each([
		"guest",
		"agent",
		"cross-session",
		"cross-agent",
		"cross-conv",
		"missing",
		"missing-parent",
		"loop",
		"deep",
		"mixed",
		"external-runtime",
		"wrong-id",
		"identity-error",
		"query-error",
		"cancel",
		"wrong-data-session",
		"missing-data-session",
		"missing-route",
		"ancestor-session",
		"ancestor-session-missing",
		"quoted",
	])("causal chain rejects %s without Helper", async (fault) => {
		const events = chain(fault === "deep" ? 65 : 2);
		const root = events[0]!;
		const middle = events[1]!;
		switch (fault) {
			case "guest":
				root.from = "acct:test:guest";
				break;
			case "agent":
				root.from = "acct:agent:main";
				relation.mockResolvedValue("owner");
				break;
			case "cross-session":
				middle.routes![0] = { agent: "main", binding: null, session: "other" };
				break;
			case "cross-agent":
				middle.routes![0] = { agent: "other", binding: null, session: ctx.session };
				break;
			case "cross-conv":
				middle.conv = "conv:test:other";
				break;
			case "missing":
				persisted.delete(root.id);
				break;
			case "missing-parent":
				delete middle.parent;
				break;
			case "loop":
				middle.parent = ctx.event!.id;
				break;
			case "mixed":
				ctx.events!.push({ ...ownerInput, from: "acct:test:guest" });
				break;
			case "external-runtime":
				middle.from = ownerInput.from;
				break;
			case "wrong-id":
				query.mockResolvedValue({ events: [{ ...root, id: "wrong" }] });
				break;
			case "identity-error":
				relation.mockRejectedValue(new Error("unavailable"));
				break;
			case "query-error":
				query.mockRejectedValue(new Error("unavailable"));
				break;
			case "cancel": {
				const controller = new AbortController();
				ctx.signal = controller.signal;
				query.mockImplementation(async () => {
					controller.abort();
					return { events: [middle] };
				});
				break;
			}
			case "wrong-data-session":
				middle.data = { session: "other" };
				break;
			case "missing-data-session":
				middle.data = {};
				break;
			case "missing-route":
				delete root.routes;
				break;
			case "ancestor-session-missing":
				root.type = "session.input";
				break;
			case "ancestor-session":
				root.data = { session: "other" };
				break;
			case "quoted":
				root.type = "agent.ask";
				root.data = { sources: [ownerInput.id], owner: true };
				break;
		}
		expect((await tool.execute({ action: "permission-guide", kind: "camera" }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it.each(["exec", "read", "write", "message"])("missing %s capability cannot initiate", async (capability) => {
		ctx.capabilities = ctx.capabilities.filter((c) => c !== capability);
		expect((await tool.execute({ action: "permission-request", kind: "camera" }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it("status and permissions never initiate an application or run owner checks", async () => {
		for (const action of ["status", "permissions"]) {
			await tool.execute({ action }, ctx);
			expect(transport.desktop).toHaveBeenLastCalledWith({ action }, ctx.signal, ctx.session);
		}
		expect(relation).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalled();
	});
	it("aborted input cannot reach the transport", async () => {
		ctx.signal = AbortSignal.abort();
		expect((await tool.execute({ action: "permission-guide", kind: "camera" }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
	it("cancellation during identity lookup cannot reach the transport", async () => {
		const controller = new AbortController();
		ctx.signal = controller.signal;
		relation.mockImplementation(async () => {
			controller.abort();
			return "owner";
		});
		expect((await tool.execute({ action: "permission-guide", kind: "camera" }, ctx)).isError).toBe(true);
		expect(transport.desktop).not.toHaveBeenCalled();
	});
});
