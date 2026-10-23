import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { awakeEnabled, setAwake, startAwake } from "./awake.js";

test("awake policy persists per home, defaults off and reports unreadable policy without protection", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-awake-"));
	try {
		expect(await awakeEnabled(home)).toBe(false);
		if (process.platform !== "darwin") return;
		await setAwake(home, true);
		expect(await awakeEnabled(home)).toBe(true);
		await setAwake(home, false);
		expect(await awakeEnabled(home)).toBe(false);
		expect(JSON.parse(await readFile(join(home, ".yonder/awake.json"), "utf8"))).toEqual({ enabled: false });
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
