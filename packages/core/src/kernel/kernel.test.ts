import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { initHome, inspectHome, offlineQuery, openKernel } from "./index.js";

test("initialize, inspect, start, stop and query a real empty home", async () => {
	const home = await mkdtemp("/tmp/yonder-kernel-");
	try {
		await initHome(home);
		const file = `${home}/agents/main/agent.yaml`;
		await writeFile(file, (await readFile(file, "utf8")).replace("      channel: cli\n", ""));
		expect(await inspectHome(home)).toMatchObject({ ok: true, errors: [] });
		await expect(initHome(home)).rejects.toThrow();
		const kernel = await openKernel(home);
		try {
			expect((await kernel.identity.lookup("person:owner")).accounts.map((item) => item.ref)).toEqual([
				"acct:cli:local",
			]);
			expect(await kernel.sessions.list({})).toEqual([]);
			await kernel.identity.unlink("acct:cli:local");
			await kernel.identity.createPerson({ id: "owner", name: "Renamed owner" });
		} finally {
			await kernel.close();
		}
		expect(await offlineQuery(home, { method: "sessions.list" })).toEqual([]);
		const restarted = await openKernel(home);
		try {
			expect((await restarted.identity.account("acct:cli:local"))?.person).toBeUndefined();
			expect((await restarted.identity.person("person:owner"))?.name).toBe("Renamed owner");
		} finally {
			await restarted.close();
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
