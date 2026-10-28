import { expect, test } from "vitest";
import type { HostCtx } from "./method-types.js";
import { registry } from "./methods.js";

test("session trace checks visibility and associates unknown only through its attempt", async () => {
	const attempt = { id: "attempt", type: "message.attempt", data: { session: "task" } };
	const unknown = { id: "unknown", type: "message.unknown", data: { attempt: "attempt", reason: "lost" } };
	const other = { id: "other", type: "message.unknown", data: { attempt: "other-attempt" } };
	const queries: unknown[] = [];
	const ctx = {
		principal: { id: "remote", scopes: ["read"], kind: "remote", transport: "gateway" },
		kernel: {
			sessions: { get: async (id: string) => ({ id, mode: id === "task" ? "task" : "main" }) },
			events: {
				query: async (q: { id?: string; after?: string }) => {
					queries.push(q);
					if (q.id) return { events: q.id === "attempt" ? [attempt] : [] };
					return q.after ? { events: [] } : { events: [attempt, unknown, other], next: "cursor" };
				},
			},
		},
	} as unknown as HostCtx;
	const call = (id: string, after?: string) =>
		registry.call("sessions.trace", { id, ...(after ? { after } : {}) }, ctx, new AbortController().signal);
	await expect(call("main")).rejects.toMatchObject({ code: "forbidden" });
	expect(await call("task")).toEqual({ events: [attempt, unknown], next: "cursor" });
	expect(await call("task", "cursor")).toEqual({ events: [] });
	expect(queries).toContainEqual({ after: "cursor", limit: 100 });
});
