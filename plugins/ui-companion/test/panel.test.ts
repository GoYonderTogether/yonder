import { expect, test } from "vitest";
import { panelGroups, panelState } from "../web/panel.mjs";

test("each real task appears once across state and BOT/matter grouping; ended parents with live descendants stay forward", () => {
	const tasks = [
		{ id: "p", parent: null, ownerAgent: "a", state: "done", title: "Parent" },
		{ id: "c", parent: "p", ownerAgent: "b", state: "active", title: "Child" },
		{ id: "g", parent: "c", ownerAgent: null, state: "review", title: "Grandchild" },
		{ id: "x", parent: "hidden", ownerAgent: "a", state: "cancelled", title: "Same title is not a relationship" },
	];
	for (const mode of ["bot", "matter"]) {
		const groups = panelGroups(tasks, mode);
		expect(groups.flatMap((g) => g.tasks.map((t) => t.id)).sort()).toEqual(["c", "g", "p", "x"]);
		expect(groups[groups.length - 1].ended).toBe(true);
	}
	const matters = panelGroups(tasks, "matter");
	expect(matters[0].root.id).toBe("p");
	expect(matters[0].ended).toBe(false);
	expect(matters[0].tasks.map((t) => t.id)).toEqual(["c", "g", "p"]);
	expect(panelState({ state: "review" })).toBe("待检查");
	expect(panelState({ state: "waiting-user", progress: null })).toBe("待补充");
});
