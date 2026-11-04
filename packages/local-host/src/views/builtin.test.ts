import { builtinViews } from "@yonder/bot-core/views/builtin";
import { createViews } from "@yonder/bot-core/views/index";
import type { Runtime } from "@yonder/runtime-adapter/node/runtime/index";
import { expect, test, vi } from "vitest";

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
