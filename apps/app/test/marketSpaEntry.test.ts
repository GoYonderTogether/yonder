import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, expect, it } from "vitest";
import { marketSpaEntry } from "../scripts/market-spa-entry";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) {
		if (!root.startsWith(join(tmpdir(), "yonder market entry "))) throw new Error("Unexpected fixture path");
		rmSync(root, { recursive: true, force: true });
	}
});
async function fixture(base: string) {
	const root = mkdtempSync(join(tmpdir(), "yonder market entry "));
	roots.push(root);
	mkdirSync(join(root, "public", "market"), { recursive: true });
	writeFileSync(join(root, "public", "market", "photo.jpg"), new Uint8Array([255, 216, 255, 217]));
	writeFileSync(
		join(root, "index.html"),
		'<!doctype html><html><head><title>Yonder</title></head><body><script type="module" src="./entry.js"></script></body></html>',
	);
	writeFileSync(join(root, "entry.js"), 'document.body.dataset.app = "market";');
	await build({
		configFile: false,
		root,
		base,
		plugins: [marketSpaEntry()],
		logLevel: "silent",
		build: { outDir: "out", minify: false },
	});
	return join(root, "out");
}
it("copies the final root SPA HTML into the market directory and preserves static market photos", async () => {
	const output = await fixture("/");
	const html = readFileSync(join(output, "index.html"), "utf8");
	expect(readFileSync(join(output, "market", "index.html"), "utf8")).toBe(html);
	expect(html).toMatch(/<!doctype html>/i);
	expect(html).toContain('src="/assets/');
	expect([...readFileSync(join(output, "market", "photo.jpg"))]).toEqual([255, 216, 255, 217]);
});
it("leaves relative gateway builds unchanged without a nested SPA entry", async () => {
	const output = await fixture("./");
	expect(existsSync(join(output, "market", "index.html"))).toBe(false);
	expect(readFileSync(join(output, "index.html"), "utf8")).toContain('src="./assets/');
	expect(existsSync(join(output, "market", "photo.jpg"))).toBe(true);
});
