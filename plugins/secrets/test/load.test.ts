import { resolve } from "node:path";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

test.each(["interaction", "tasks", "secrets"])("%s plugin loads", async (name) => {
	expect(await checkPlugin(resolve("plugins", name))).toEqual([]);
});
