import { expectTypeOf, test } from "vitest";
import type { EventQuery, PluginAPI } from "./types.js";

test("plugin event query accepts an optional exact event id", () => {
	expectTypeOf<EventQuery>().toHaveProperty("id").toEqualTypeOf<string | undefined>();
	expectTypeOf<Parameters<PluginAPI["events"]["query"]>[0]>().toEqualTypeOf<EventQuery>();
	const exact: EventQuery = { id: "parent-event", limit: 1 };
	expectTypeOf(exact).toEqualTypeOf<EventQuery>();
	expectTypeOf({} as EventQuery).toEqualTypeOf<EventQuery>();
});

test("plugin subagents reuse task_run input and tool result", () => {
	expectTypeOf<Parameters<PluginAPI["subagents"]["run"]>[0]>().toMatchTypeOf<{ preset: string; task: string }>();
	expectTypeOf<ReturnType<PluginAPI["subagents"]["run"]>>().toEqualTypeOf<Promise<import("./types.js").ToolResult>>();
});
