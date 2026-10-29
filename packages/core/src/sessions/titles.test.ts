import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createStore } from "../store/index.js";
import { autoTitle, cleanTitle } from "./titles.js";

test("cleanTitle keeps the first line, strips quotes and cuts to 12 characters", () => {
	expect(cleanTitle("\n“整理本周的发票报销材料并提交财务部门审核”。\n多余")).toBe("整理本周的发票报销材料并");
	expect(cleanTitle("")).toBe("");
});

test("autoTitle never touches a session that already has a title", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		await store.sessions.put({
			id: "1",
			agent: null,
			profile: "default",
			mode: "task",
			key: "1",
			version: "1",
			opened: "now",
			closed: "now",
			title: "我的标题",
		});
		const runtime = {
			sessionConfig: async () => {
				throw new Error("model must not be consulted");
			},
		} as unknown as Runtime;
		const rename = async () => {
			throw new Error("must not rename");
		};
		await expect(
			autoTitle({ id: "1", input: "你好", reply: "你好", store, runtime, workbench: { rename } as never }),
		).resolves.toBeUndefined();
	} finally {
		await db.close();
	}
});
