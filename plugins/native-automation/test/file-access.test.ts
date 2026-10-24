import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Compile only the Foundation/POSIX file implementation with a temp-file test
// entrypoint. Never launch the app, launcher, permission APIs or protected paths.
it.skipIf(process.platform !== "darwin")(
	"Swift file host: ordinary temporary files only",
	async () => {
		const scratch = await mkdtemp(join(tmpdir(), "yonder-file-test-"));
		const root = fileURLToPath(new URL("../../../", import.meta.url));
		try {
			const binary = join(scratch, "file-test");
			const build = spawnSync(
				"swiftc",
				[
					"-parse-as-library",
					"-module-cache-path",
					join(scratch, "modules"),
					"packages/macos-helper/Sources/YonderHelper/FileAccess.swift",
					"plugins/native-automation/test/file-access.swift",
					"-o",
					binary,
				],
				{ cwd: root, encoding: "utf8" },
			);
			expect(build.status, build.stderr).toBe(0);
			const run = spawnSync(binary, [], { encoding: "utf8" });
			expect(run.status, run.stderr).toBe(0);
			expect(run.stdout).toContain("24 passed, 0 failed");
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	},
	120000,
);
