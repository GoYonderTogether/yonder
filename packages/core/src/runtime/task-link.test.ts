import type { ToolContext } from "@yonder/sdk";
import { describe, expect, it } from "vitest";
import { Runtime } from "./index.js";

const ctx = (session: string, eventId?: string) =>
	({ session, ...(eventId ? { event: { id: eventId, type: "session.input" } } : {}) }) as ToolContext;

describe("Runtime.exportTaskLink unit projection", () => {
	it("projects parent session, source event, and child parameter", () => {
		expect(Runtime.exportTaskLink(ctx("parent-a", "event-a"), "child-a")).toEqual({
			type: "task.linked",
			from: "system:runtime",
			data: { parentSession: "parent-a", childSession: "child-a", sourceEvent: "event-a" },
		});
	});

	it("keeps two children isolated for the same context", () => {
		const context = ctx("parent-a", "event-a");
		const first = Runtime.exportTaskLink(context, "child-a");
		const second = Runtime.exportTaskLink(context, "child-b");
		expect(first.data.childSession).toBe("child-a");
		expect(second.data.childSession).toBe("child-b");
		expect(first.data.parentSession).toBe(second.data.parentSession);
		expect(first.data.sourceEvent).toBe(second.data.sourceEvent);
	});

	it("fails closed without a source event instead of inventing one", () => {
		expect(Runtime.exportTaskLink(ctx("parent-a"), "child-a").data).toEqual({
			parentSession: "parent-a",
			childSession: "child-a",
		});
	});

	it("has no initialize input that could override projected data", () => {
		expect(Runtime.exportTaskLink.length).toBe(2);
		expect(Runtime.exportTaskLink(ctx("trusted-parent", "trusted-event"), "trusted-child").data).toEqual({
			parentSession: "trusted-parent",
			childSession: "trusted-child",
			sourceEvent: "trusted-event",
		});
	});
});
