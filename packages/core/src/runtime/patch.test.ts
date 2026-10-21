import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// patches/pi-durable-1.3.0.patch is applied by `postinstall`; the runtime relies on its native boundary and receipt.
it("runs against the patched pi-durable boundary", async () => {
	const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-durable"));
	const root = resolve(dirname(entry), "..");
	const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version: string };
	expect(version).toBe("1.3.0");
	const generation = await readFile(resolve(root, "dist/harness/generation.js"), "utf8");
	expect(generation).toContain("prepareBoundary(tx, conversationId, runtime.settings)");
	expect(generation).toContain('runtime.hooks.each("shouldRetry"');
});
