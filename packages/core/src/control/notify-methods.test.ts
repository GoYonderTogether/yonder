import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createNotificationPrefs } from "../kernel/notifications.js";
import { openDatabase } from "../runtime/db.js";
import { migrate } from "../store/migrations.js";
import { parseYonderConfig } from "../config/index.js";
import { type HostCtx, registry, socketPrincipal } from "./methods.js";

test("notification preferences merge startup defaults, persist, normalize and apply immediately", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-prefs-"));
	const db = await openDatabase(join(home, "state.db"));
	try {
		await migrate(db);
		const config = parseYonderConfig(
			JSON.stringify({
				schema: 1,
				notifications: { default: "mention", conversations: { "conv:qq:g": "mute", "session-id": "mentions" } },
			}),
			"yonder.yaml",
		).notifications;
		const notifications = await createNotificationPrefs(db, config);
		const ctx = { kernel: { notifications }, principal: socketPrincipal } as unknown as HostCtx;
		const call = (name: string, params: object) => registry.call(name, params, ctx, new AbortController().signal);
		expect(await call("notifications.prefs.get", {})).toEqual({
			default: "mentions",
			conversations: { "conv:qq:g": "mute", "session-id": "mentions" },
			sources: { default: "yaml", conversations: { "conv:qq:g": "yaml", "session-id": "yaml" } },
		});
		await call("notifications.prefs.set", { conv: "session-id", level: "mention" });
		await call("notifications.prefs.set", { conv: "*", level: "mute" });
		expect(notifications.level("conv:qq:g", "session-id")).toBe("mentions");
		expect(notifications.level(undefined, "other")).toBe("mute");
		const restarted = await createNotificationPrefs(db, config);
		expect(restarted.get().sources).toEqual({
			default: "runtime",
			conversations: { "conv:qq:g": "yaml", "session-id": "runtime" },
		});
		await call("notifications.prefs.set", { conv: "session-id", level: null });
		expect(notifications.get().sources.conversations["session-id"]).toBe("yaml");
		expect(() => registry.prepare("notifications.prefs.set", { conv: "", level: "all" }, socketPrincipal)).toThrow();
	} finally {
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});
