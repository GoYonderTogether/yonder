import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Store } from "../src/store.js";

it("serializes appends from independent plugin processes without losing records", async () => {
	const root = await mkdtemp(join(tmpdir(), "memory-lock-test-"));
	try {
		const storeUrl = new URL("../dist/store.js", import.meta.url).href;
		const script = `
			import { Store } from ${JSON.stringify(storeUrl)};
			const s = new Store(process.argv[1]);
			const n = Number(process.argv[2]);
			const ctx = { op: "test", id: String(n), by: "plugin:memory", session: "synthetic", signal: new AbortController().signal };
			for (let i = 0; i < 20; i++) await s.append("timeline/test.md", "header\\n", old => "record-" + n + "-" + i + "\\n", ctx);
		`;
		const run = (n: number) =>
			new Promise<void>((resolve, reject) => {
				const child = spawn(process.execPath, ["--input-type=module", "-e", script, root, String(n)], {
					stdio: "inherit",
				});
				child.once("error", reject);
				child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))));
			});
		await Promise.all([run(1), run(2)]);
		const text = await readFile(join(root, "timeline/test.md"), "utf8");
		for (const n of [1, 2]) for (let i = 0; i < 20; i++) expect(text).toContain(`record-${n}-${i}`);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("refuses a synthetic symlink write target without touching its referent", async () => {
	const root = await mkdtemp(join(tmpdir(), "memory-symlink-test-"));
	const outside = join(root, "outside.txt"),
		link = join(root, "inside.txt");
	try {
		await writeFile(outside, "preserve");
		await symlink(outside, link);
		const store = new Store(root);
		await expect(
			store.edit("inside.txt", () => "overwrite", {
				op: "test",
				id: "synthetic",
				by: "plugin:memory",
				session: "test",
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("Symbolic links are not allowed");
		expect(await readFile(outside, "utf8")).toBe("preserve");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
