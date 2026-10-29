import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("general task context appends project rules; others do not", async () => {
	const collector = createRegistrationCollector();
	await plugin.setup(collector.api as never);
	const render = async (id: string, ctx: object) => {
		const context = collector.registrations.contexts.find((item) => item.id === id);
		if (!context) throw new Error(`missing ${id}`);
		return context.render(ctx as never);
	};
	const rules = async () => [{ path: "AGENTS.md", content: "rule body" }];
	expect(await render("task-general", { projectRules: rules })).toContain("# AGENTS.md\n\nrule body");
	expect(await render("task-general", {})).not.toContain("rule body");
	expect(await render("task-coding", { projectRules: rules })).not.toContain("rule body");
});
