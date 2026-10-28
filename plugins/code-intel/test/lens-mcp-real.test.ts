import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { callLens, stopLens } from "../src/lens-mcp.js";

test.skipIf(!process.env.YONDER_LENS_REAL)(
	"real pi-lens connection builds its index between queued calls",
	async () => {
		const dir = await mkdtemp(join(tmpdir(), "yonder-lens-real-"));
		try {
			await copyFile(resolve("packages/sdk/src/index.ts"), join(dir, "index.ts"));
			const ctx = { env: new NodeExecutionEnv({ cwd: dir }), signal: new AbortController().signal } as ToolContext;
			const search = () => callLens("pilens_symbol_search", { query: "parseRef" }, ctx);
			const [first, second] = await Promise.all([search(), search()]);
			expect(first.isError).not.toBe(true);
			expect(second.isError).not.toBe(true);
			let found = false;
			for (let i = 0; i < 15 && !found; i++) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				found = (await search()).text.includes("parseRef");
			}
			expect(found).toBe(true);
			const aborted = new AbortController();
			aborted.abort();
			await expect(
				callLens("pilens_symbol_search", { query: "parseRef" }, { ...ctx, signal: aborted.signal }),
			).rejects.toThrow();
		} finally {
			await stopLens();
			await rm(dir, { recursive: true, force: true });
		}
	},
	30_000,
);
