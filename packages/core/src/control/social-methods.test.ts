import { expect, test } from "vitest";
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
