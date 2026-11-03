import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// The workspace must resolve the pinned source fork, with no install-time patch.
it("runs against the vendored pi-durable fork", async () => {
	const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-durable"));
	const root = await realpath(resolve(dirname(entry), ".."));
	const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version: string };
	expect(version).toBe("1.3.0");
	expect(root).toBe(resolve("packages/pi-durable"));
	const source = JSON.parse(await readFile(resolve(root, "FORK_SOURCE.json"), "utf8"));
	expect(source.repository).toBe("https://github.com/GoYonderTogether/pi.git");
	expect(source.commit).toMatch(/^[a-f0-9]{40}$/);
	expect(await readFile(resolve(root, "FORK.md"), "utf8")).toContain("D28");
	const live = await readFile(resolve(root, "dist/harness/live.js"), "utf8");
	expect(live).toContain("pi.run-receipt");
	const harness = await readFile(resolve(root, "dist/harness/harness.js"), "utf8");
	expect(harness).toContain("beforeAgent");
	const generation = await readFile(resolve(root, "dist/harness/generation.js"), "utf8");
	expect(generation).toContain("prepareBoundary(tx, conversationId, runtime.settings)");
	expect(generation).toContain('runtime.hooks.each("shouldRetry"');
});
