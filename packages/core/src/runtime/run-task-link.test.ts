import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { ToolContext, YEvent } from "@yonder/sdk";
import { describe, expect, it } from "vitest";
import { Runtime } from "./index.js";

type InvocationMap = WeakMap<ToolContext, { api: ToolExecutionApi; context: Context }>;
type RuntimeTestAccess = {
	toolInvocations: InvocationMap;
	options: { recordEvent: (event: YEvent) => Promise<void> };
};

const invocation = (session: string, eventId: string, child: string) => {
	const ctx = {
		session,
		event: { id: eventId, type: "session.input" },
	} as ToolContext;
	const transaction = {
		scanConversations: async () => ({ items: [] }),
		createConversation: async () => ({ id: child }),
		doc: async () => ({}),
	};
	const api = {
		taskId: `task-${child}`,
		commit: async (work: (tx: typeof transaction) => unknown) => work(transaction),
	} as unknown as ToolExecutionApi;
	return { ctx, api, context: {} as Context };
};

describe("Runtime.runTask task-link integration", () => {
	it("records each committed child against its trusted invocation before initialize fails", async () => {
		const runtime = Object.create(Runtime.prototype) as Runtime;
		const testAccess = runtime as unknown as RuntimeTestAccess;
		testAccess.toolInvocations = new WeakMap();
		const captured: YEvent[] = [];
		testAccess.options = { recordEvent: async (event: YEvent) => void captured.push(event) };
		const first = invocation("parent-a", "source-a", "child-a");
		const second = invocation("parent-b", "source-b", "child-b");
		testAccess.toolInvocations.set(first.ctx, { api: first.api, context: first.context });
		testAccess.toolInvocations.set(second.ctx, { api: second.api, context: second.context });
		const initializeFailure = new Error("deliberate test stop before provider work");
		const initialize = async (childId: string) => {
			// A caller-controlled RuntimeInput event cannot change the already-recorded source.
			expect(childId).toMatch(/^child-/);
			return Promise.reject(initializeFailure);
		};

		await expect(Runtime.prototype.runTask.call(runtime, first.ctx, initialize)).rejects.toBe(initializeFailure);
		await expect(Runtime.prototype.runTask.call(runtime, second.ctx, initialize)).rejects.toBe(initializeFailure);
		expect(captured).toEqual([
			{
				type: "task.linked",
				from: "system:runtime",
				data: { parentSession: "parent-a", childSession: "child-a", sourceEvent: "source-a" },
			},
			{
				type: "task.linked",
				from: "system:runtime",
				data: { parentSession: "parent-b", childSession: "child-b", sourceEvent: "source-b" },
			},
		]);
	});

	it("rejects without an active invocation and records no event", async () => {
		const runtime = Object.create(Runtime.prototype) as Runtime;
		const testAccess = runtime as unknown as RuntimeTestAccess;
		testAccess.toolInvocations = new WeakMap();
		const captured: YEvent[] = [];
		testAccess.options = { recordEvent: async (event: YEvent) => void captured.push(event) };
		const ctx = { session: "unbound", event: { id: "untrusted", type: "session.input" } } as ToolContext;

		await expect(
			Runtime.prototype.runTask.call(runtime, ctx, async () => ({ text: "unused" }) as never),
		).rejects.toThrow("task_run requires an active runtime tool invocation");
		expect(captured).toEqual([]);
	});
});
