import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test("upgrade-groups runs through the installed setup symlink instead of silently exiting", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-cli-"));
	try {
		await writeFile(join(home, "yonder.yaml"), "schema: 1\nagents: []\n");
		const cli = join(home, "setup.js");
		await symlink(fileURLToPath(new URL("../dist/setup.js", import.meta.url)), cli);
		const { stdout, stderr } = await promisify(execFile)(process.execPath, [cli, "upgrade-groups", "--home", home]);
		expect(stderr).toBe("");
		expect(JSON.parse(stdout)).toEqual({ changed: [], skipped: [] });
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
