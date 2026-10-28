import { expect, test, vi } from "vitest";
import { SocialError } from "../kernel/social.js";
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
