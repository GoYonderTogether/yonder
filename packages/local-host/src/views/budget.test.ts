import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseYonderConfig } from "@yonder/local-host/config/index";
import { budgetEventType } from "@yonder/local-host/sessions/budget";
import { createStore } from "@yonder/local-host/store/index";
import { budgetView, budgetViewId } from "@yonder/local-host/views/budget";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

test("budget view reports usage against the configured limits without changing state", async () => {
	const home = await tempHome("yonder-budget-view-");
	const db = await openDatabase(join(home, "state.db"));
	try {
		await createStore(db);
		await db.run(
			"INSERT INTO y_sessions (id, agent, profile, mode, key, version, opened) VALUES (?, ?, ?, ?, ?, ?, ?)",
			9,
			null,
			"owner",
			"task",
			"key-9",
			"0.0.0",
			new Date(Date.now() - 120_000).toISOString(),
		);
		await db.run(
			"INSERT INTO y_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			"01BUDGETVIEW0000000000000A",
			new Date(Date.now() - 60_000).toISOString(),
			"run.end",
			null,
			null,
			null,
			JSON.stringify({ session: "9", usage: { input: 900, output: 100 } }),
			null,
		);
		const config = parseYonderConfig(
			"schema: 1\nbudget:\n  tokens: 500\n  maxMinutes: 1\n  maxWakeups: 1\n  overBudget: record\n",
			"yonder.yaml",
		);
		const { decl, provider } = budgetView({ db, config });
		expect(decl).toEqual({ id: budgetViewId, plugin: "core", title: "预算", placement: "rail", scope: "session" });
		const data = await provider.data("9");
		expect(data.content).toEqual({
			type: "kv",
			rows: [
				{ k: "Token", v: "1000 / 500" },
				{ k: "时长（分钟）", v: "2 / 1" },
				{ k: "唤醒", v: "1 / 1 次" },
				{ k: "超限处理", v: "record（只记录）" },
			],
		});
		await db.run(
			"INSERT INTO y_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			"01BUDGETVIEW0000000000000B",
			new Date().toISOString(),
			budgetEventType,
			null,
			null,
			null,
			JSON.stringify({ session: "9", kind: "tokens", limit: 500, value: 1000 }),
			null,
		);
		// The badge counts exceeded limits; the view itself stays read-only.
		expect((await provider.data("9")).badge).toBe(1);
		expect(await db.all("SELECT id FROM y_events WHERE type = ?", budgetEventType)).toHaveLength(1);
	} finally {
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("budget view without a session is rejected and unlimited limits say so", async () => {
	const home = await tempHome("yonder-budget-view-");
	const db = await openDatabase(join(home, "state.db"));
	try {
		await createStore(db);
		const config = parseYonderConfig("schema: 1\n", "yonder.yaml");
		const { provider } = budgetView({ db, config });
		await expect(provider.data()).rejects.toThrow("Session required");
		const data = await provider.data("404");
		expect(data.content).toMatchObject({
			type: "kv",
			rows: [
				{ k: "Token", v: "0（不限）" },
				{ k: "时长（分钟）", v: "0（不限）" },
				{ k: "唤醒", v: "0 次（不限）" },
				{ k: "超限处理", v: "record（只记录）" },
			],
		});
	} finally {
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});
