import { expect, test, vi } from "vitest";
import type { Runtime } from "../runtime/index.js";
import { builtinViews } from "./builtin.js";
import { createViews } from "./index.js";

test("background views request only the selected session in both placements", async () => {
	const backgroundList = vi.fn(async (session: string) => [
		{
			id: session === "1" ? "10" : "20",
			name: "bash",
			started: 0,
			state: { status: "terminal", outcome: { status: "aborted" } },
		},
	]);
	const views = createViews();
	for (const { decl, provider } of builtinViews(() => ({ backgroundList }) as unknown as Runtime))
		views.register("core", decl, provider);
	for (const placement of ["rail", "floating"]) {
		const id = `core.background.${placement}`;
		await expect(views.data(id)).rejects.toMatchObject({ code: "invalid_params" });
		expect(await views.data(id, "1")).toMatchObject({ content: { items: [{ id: "10", subtitle: "aborted" }] } });
		expect(await views.data(id, "2")).toMatchObject({ content: { items: [{ id: "20" }] } });
	}
	expect(backgroundList.mock.calls.map(([session]) => session)).toEqual(["1", "2", "1", "2"]);
});
