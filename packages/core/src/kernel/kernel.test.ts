import { mkdtemp, rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { initHome, inspectHome, offlineQuery, openKernel } from "./index.js";

test("initialize, inspect, start, stop and query a real empty home", async () => {
	const home = await mkdtemp("/tmp/yonder-kernel-");
	try {
		await initHome(home);
		expect(await inspectHome(home)).toMatchObject({ ok: true, errors: [] });
		await expect(initHome(home)).rejects.toThrow();
		const kernel = await openKernel(home);
		try {
			expect((await kernel.identity.lookup("person:owner")).accounts.map((item) => item.ref)).toEqual([
				"acct:cli:local",
			]);
			expect(await kernel.sessions.list({})).toEqual([]);
		} finally {
			await kernel.close();
		}
		expect(await offlineQuery(home, { method: "sessions.list" })).toEqual([]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
