import { expect, test } from "vitest";
import type { HostCtx } from "./method-types.js";
import { registry } from "./methods.js";

const task = { id: "task", mode: "task", agent: "main" };
const bot = { id: "bot-main", mode: "main", agent: "helper" };

function host(scopes: string[], calls: string[]) {
	const session = (id: string) => (id === task.id ? task : id === bot.id ? bot : undefined);
	return {
		principal: { id: "remote", scopes, kind: "remote", transport: "gateway" },
		kernel: {
			sessions: {
				get: async (id: string) => session(id),
				archive: async (id: string) => calls.push(`archive:${id}`),
				unarchive: async (id: string) => calls.push(`unarchive:${id}`),
				pin: async (id: string) => calls.push(`pin:${id}`),
				unpin: async (id: string) => calls.push(`unpin:${id}`),
				rename: async (id: string, title: string) => calls.push(`rename:${id}:${title}`),
				botOverview: async (agent: string) => ({
					channels: [{ id: "feishu", label: "feishu", kind: "feishu" }],
					sessions: [{ ...task, agent }],
				}),
			},
			bots: { list: async () => [{ agent: "helper", name: "Helper" }] },
		},
	} as unknown as HostCtx;
}

const call = (method: string, params: unknown, ctx: HostCtx) =>
	registry.call(method, params as never, ctx, new AbortController().signal);

test("workbench methods need write scope and refuse unknown sessions", async () => {
	const calls: string[] = [];
	const writer = host(["write"], calls);
	expect(await call("sessions.archive", { id: task.id }, writer)).toEqual({ ok: true });
	expect(await call("sessions.unarchive", { id: task.id }, writer)).toEqual({ ok: true });
	expect(await call("sessions.pin", { id: task.id }, writer)).toEqual({ ok: true });
	expect(await call("sessions.unpin", { id: task.id }, writer)).toEqual({ ok: true });
	expect(await call("sessions.rename", { id: task.id, title: "改名" }, writer)).toEqual({ ok: true });
	expect(calls).toEqual(["archive:task", "unarchive:task", "pin:task", "unpin:task", "rename:task:改名"]);
	await expect(call("sessions.archive", { id: "missing" }, writer)).rejects.toMatchObject({ code: "not_found" });
	await expect(call("sessions.pin", { id: "missing" }, writer)).rejects.toMatchObject({ code: "not_found" });
	const reader = host(["read"], calls);
	await expect(call("sessions.archive", { id: task.id }, reader)).rejects.toMatchObject({ code: "forbidden" });
});

test("Bot conversations need the owner scope, bots.overview lists channels and sub-sessions", async () => {
	const calls: string[] = [];
	await expect(call("sessions.archive", { id: bot.id }, host(["write"], calls))).rejects.toMatchObject({
		code: "forbidden",
	});
	expect(calls).toEqual([]);
	expect(await call("sessions.pin", { id: bot.id }, host(["write", "owner"], calls))).toEqual({ ok: true });
	expect(calls).toEqual(["pin:bot-main"]);
	expect(await call("bots.overview", { bot: "helper" }, host(["owner"], calls))).toEqual({
		channels: [{ id: "feishu", label: "feishu", kind: "feishu" }],
		sessions: [{ session: { ...task, agent: "helper" } }],
	});
	await expect(call("bots.overview", { bot: "stranger" }, host(["owner"], calls))).rejects.toMatchObject({
		code: "not_found",
	});
	await expect(call("bots.overview", { bot: "helper" }, host(["read"], calls))).rejects.toMatchObject({
		code: "forbidden",
	});
});
