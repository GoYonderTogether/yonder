import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { awakeEnabled, awakeGraceMs, awakeMode, createAwakeHold, setAwake, startAwake } from "./awake.js";

test("awake policy persists per home, defaults off and reports unreadable policy without protection", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-awake-"));
	try {
		expect(await awakeEnabled(home)).toBe(false);
		if (process.platform !== "darwin") return;
		await setAwake(home, true);
		expect(await awakeEnabled(home)).toBe(true);
		await setAwake(home, false);
		expect(await awakeEnabled(home)).toBe(false);
		expect(JSON.parse(await readFile(join(home, ".yonder/awake.json"), "utf8"))).toEqual({
			enabled: false,
			mode: "off",
		});
		await setAwake(home, "always");
		expect(await awakeMode(home)).toBe("always");
		await writeFile(join(home, ".yonder/awake.json"), '{"enabled":true}');
		expect(await awakeMode(home)).toBe("tasks");
		await writeFile(join(home, ".yonder/awake.json"), '{"mode":"invalid"}');
		await expect(awakeMode(home)).rejects.toThrow("Invalid awake mode");
		await writeFile(join(home, ".yonder/awake.json"), "{");
		const host = startAwake(home, async () => ({ active: 0 }));
		try {
			await expect.poll(() => host.status().error).toBeTruthy();
			expect(host.status().protected).toBe(false);
		} finally {
			host.close();
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("task grace lasts at least 15 minutes, renews after follow-up work and switches exclusively", () => {
	const hold = createAwakeHold();
	expect(hold("tasks", 0, 0).holding).toBe(false);
	expect(hold("tasks", 2, 100).reason).toBe("tasks");
	const end = 1000;
	expect(hold("tasks", 0, end)).toMatchObject({ holding: true, reason: "grace", holdUntil: end + awakeGraceMs });
	expect(hold("tasks", 0, end + 10 * 60 * 1000).holding).toBe(true);
	expect(hold("tasks", 0, end + awakeGraceMs).holding).toBe(true);
	expect(hold("tasks", 1, end + awakeGraceMs).reason).toBe("tasks");
	const followupEnd = end + awakeGraceMs + 60000;
	expect(hold("tasks", 0, followupEnd).holdUntil).toBe(followupEnd + awakeGraceMs);
	expect(hold("tasks", 0, followupEnd + awakeGraceMs).holding).toBe(true);
	expect(hold("tasks", 0, followupEnd + awakeGraceMs + 1).holding).toBe(false);
	expect(hold("always", 0, followupEnd + 99999999).holding).toBe(true);
	expect(hold("off", 0, followupEnd + 99999999).holding).toBe(false);
	expect(hold("tasks", 0, followupEnd + 99999999).holding).toBe(false);
});
