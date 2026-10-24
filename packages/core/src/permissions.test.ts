import type { PermissionProvider, PermissionRequest, ToolContext } from "@yonder/sdk";
import { describe, expect, it, vi } from "vitest";
import { createPermissions } from "./permissions.js";
import { createPermissionsTool } from "./tools/permissions.js";

function fixture(enabled = ["permission-test"]) {
	const controller = new AbortController();
	const ctx: ToolContext = {
		agent: "main",
		profile: "limited",
		session: "1",
		capabilities: ["read"],
		env: { id: "node:local" } as ToolContext["env"],
		signal: controller.signal,
		event: { id: "original", ts: "2026-10-24T00:00:00Z", type: "message.in", from: "acct:test:owner", data: {} },
	};
	const selected = vi.fn(async (actual: ToolContext) => {
		expect(actual).toBe(ctx);
		return enabled;
	});
	const registry = createPermissions(selected);
	const raw = {
		platform: "contract-test",
		result: { state: "requested", responsibleIdentity: { executable: "test-driver" } },
	};
	const invoke = vi.fn(async (_request: PermissionRequest, _ctx: ToolContext) => raw);
	const provider: PermissionProvider = {
		id: "permission-test.os",
		scope: "contract test only",
		kinds: ["camera"],
		invoke,
	};
	registry.register(provider);
	const tool = createPermissionsTool(registry);
	return { ctx, controller, registry, tool, invoke, provider, raw, enabled, selected };
}
const request = { provider: "permission-test.os", kind: "camera", action: "status" } as const;
describe("permissions tool → actual registry → provider", () => {
	it("list exposes static selected descriptors, not a status probe", async () => {
		const f = fixture();
		expect(JSON.parse((await f.tool.execute({ action: "list" }, f.ctx)).text)).toEqual([
			{ id: f.provider.id, scope: f.provider.scope, kinds: ["camera"] },
		]);
		expect(f.invoke).not.toHaveBeenCalled();
		f.enabled.splice(0);
		expect(await f.registry.list(f.ctx)).toEqual([]);
	});
	it.each(["status", "request", "guide", "watch"] as const)(
		"%s preserves original context, signal and raw state",
		async (action) => {
			const f = fixture();
			const input = { ...request, action };
			const response = await f.tool.execute(input, f.ctx);
			expect(response.isError).toBeUndefined();
			expect(JSON.parse(response.text)).toEqual(f.raw);
			expect(f.invoke).toHaveBeenCalledExactlyOnceWith(input, f.ctx);
			expect(f.invoke.mock.calls[0]?.[1]).toBe(f.ctx);
			// status must not be silently promoted to request.
			expect(f.invoke.mock.calls[0]?.[0].action).toBe(action);
		},
	);
	it("profile-disabled provider is denied even through the built-in tool", async () => {
		const f = fixture([]);
		const response = await f.tool.execute({ ...request, action: "request" }, f.ctx);
		expect(response.isError).toBe(true);
		expect(response.text).toContain("not enabled");
		expect(f.invoke).not.toHaveBeenCalled();
	});
	it("duplicate, unknown provider and kind fail before driver", async () => {
		const f = fixture();
		expect(() => f.registry.register(f.provider)).toThrow("Duplicate");
		await expect(f.registry.invoke({ ...request, provider: "missing" }, f.ctx)).rejects.toThrow(
			"Unknown permission provider",
		);
		await expect(f.registry.invoke({ ...request, kind: "missing" }, f.ctx)).rejects.toThrow("Unknown permission kind");
		expect(f.invoke).not.toHaveBeenCalled();
	});
	it.each([
		{},
		{ action: "list", kind: "camera" },
		{ ...request, action: "all" },
		{ ...request, timeout: 0 },
		{ ...request, timeout: Number.NaN },
		{ ...request, timeout: Infinity },
		{ ...request, timeout: "1" },
		{ ...request, kind: "" },
		{ ...request, credential: "must-not-pass" },
	])("rejects malformed tool arguments %j", async (input) => {
		const f = fixture();
		expect((await f.tool.execute(input, f.ctx)).isError).toBe(true);
		expect(f.invoke).not.toHaveBeenCalled();
	});
	it("validates direct SDK requests too", async () => {
		const f = fixture();
		await expect(f.registry.invoke({ ...request, timeout: -1 }, f.ctx)).rejects.toThrow("Invalid");
		await expect(f.registry.invoke({ ...request, extra: true } as typeof request, f.ctx)).rejects.toThrow("Invalid");
	});
	it("pre-aborted context never invokes provider", async () => {
		const f = fixture();
		f.controller.abort();
		expect((await f.tool.execute(request, f.ctx)).isError).toBe(true);
		expect(f.invoke).not.toHaveBeenCalled();
	});
	it("in-flight abort reaches the provider's original signal", async () => {
		const f = fixture();
		f.invoke.mockImplementation(
			async (_request, ctx) =>
				new Promise((_resolve, reject) => {
					expect(ctx).toBe(f.ctx);
					ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
					f.controller.abort(new Error("cancelled by caller"));
				}),
		);
		expect((await f.tool.execute({ ...request, action: "watch", timeout: 1 }, f.ctx)).text).toContain(
			"cancelled by caller",
		);
	});
});
