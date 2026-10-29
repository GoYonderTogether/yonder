import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import { createSocial, SocialError } from "../kernel/social.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { type HostCtx, MethodError, registry, socketPrincipal } from "./methods.js";

test("social control methods validate, pass the principal, and expose structured errors", async () => {
	const principal = socketPrincipal;
	const ctx = {
		principal,
		kernel: {
			social: {
				inspect: async (_params: unknown, actor: unknown) => actor,
				update: async () => {
					throw new SocialError("conflict", "stale", { currentRevision: "2" });
				},
			},
		},
	} as unknown as HostCtx;
	const signal = new AbortController().signal;
	expect(await registry.call("social.inspect", { agent: "a", conv: "conv:test:g" }, ctx, signal)).toBe(principal);
	await expect(
		registry.call(
			"social.update",
			{ agent: "a", conv: "conv:test:g", expectedRevision: "1", patch: { mode: "mention" }, reason: "test" },
			ctx,
			signal,
		),
	).rejects.toMatchObject({ code: "conflict", data: { currentRevision: "2" } } satisfies Partial<MethodError>);
	expect(() => registry.prepare("social.update", { agent: "a" }, principal)).toThrow(MethodError);
});

test("pre-handler social update rejections are audited and never reach the handler", async () => {
	const principal = { id: "gateway:remote", transport: "gateway", kind: "remote", scopes: ["read"] };
	const auditDenied = vi.fn(async () => {});
	const update = vi.fn();
	const ctx = { principal, kernel: { social: { auditDenied, update } } } as unknown as HostCtx;
	const params = { agent: "main", conv: "conv:test:group", expectedRevision: "r", patch: {}, reason: "private" };
	await expect(registry.call("social.update", params, ctx, new AbortController().signal)).rejects.toMatchObject({
		code: "forbidden",
	});
	expect(auditDenied).toHaveBeenCalledWith(principal, params, "forbidden");
	expect(update).not.toHaveBeenCalled();
	const admin = { ...ctx, principal: socketPrincipal };
	await expect(registry.prepareCall("social.update", { conv: "bad" }, admin)).rejects.toMatchObject({
		code: "invalid_params",
	});
	expect(auditDenied).toHaveBeenCalledWith(socketPrincipal, { conv: "bad" }, "invalid_params");
});

test("social.groups lists group conversations with mode and tags from the real store and social service", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-social-groups-"));
	try {
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
			social: {
				enabled: true,
				authorized: { conversations: ["conv:test:a", "conv:test:b"] },
				defaults: { group: { mode: "batch" } },
				conversations: {
					"conv:test:a": { mode: "mention", tags: { value: "high" } },
				},
			},
		});
		await writeFile(join(home, "yonder.yaml"), "{}");
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		const store = await createStore(await openDatabase(":memory:"));
		const social = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			target: async () => ({ kind: "group" }),
			record: async () => {},
			validate: async () => {},
			reload: async () => {},
		});
		const route = [{ agent: "main", binding: null }];
		const send = async (conv: string, data: Record<string, unknown>) => {
			await new Promise((done) => setTimeout(done, 5));
			return store.events.record({ type: "message.in", from: "acct:test:m", conv, data }, route);
		};
		await send("conv:test:a", { kind: "group", title: "Alpha" });
		await send("conv:test:b", { kind: "group", groupName: "Beta" });
		await send("conv:test:b", { kind: "group" });
		await send("conv:test:dm", { kind: "dm" });
		const ctx = { principal: socketPrincipal, kernel: { social, events: store.events } } as unknown as HostCtx;
		const rows = (await registry.call("social.groups", { agent: "main" }, ctx, new AbortController().signal)) as Array<{
			conv: string;
			title?: string;
			mode: string;
			tags: object;
			lastActiveAt: string;
		}>;
		expect(rows.map((r) => r.conv).sort()).toEqual(["conv:test:a", "conv:test:b"]);
		const a = rows.find((r) => r.conv === "conv:test:a");
		const b = rows.find((r) => r.conv === "conv:test:b");
		expect(a).toMatchObject({ title: "Alpha", mode: "mention", tags: { value: "high", rhythm: "normal" } });
		expect(b).toMatchObject({ title: "Beta", mode: "batch", tags: { value: "medium", rhythm: "normal" } });
		expect(rows[0]?.conv).toBe("conv:test:b");
		expect(() =>
			registry.prepare("social.groups", { agent: "main" }, { ...socketPrincipal, scopes: ["read"] } as never),
		).toThrow(MethodError);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
