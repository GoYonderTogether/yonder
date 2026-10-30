import { expect, it } from "vitest";
import { hasRailContent, viewHasContent } from "../src/work/lib/railContent";
import { emptyView } from "../src/work/lib/useSession";

it("only treats actual rail data as content, not empty default tabs", () => {
	expect(hasRailContent(emptyView, false, false, false)).toBe(false);
	expect(
		hasRailContent({ ...emptyView, todos: [{ id: "1", text: "待办", state: "todo", order: 0 }] }, false, false, false),
	).toBe(true);
	expect(viewHasContent({ type: "list", items: [] })).toBe(false);
	expect(viewHasContent({ type: "list", items: [{ id: "1" }] })).toBe(true);
	expect(hasRailContent(emptyView, false, false, true)).toBe(true);
});
