import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { boundToolOutput, cacheToolOutput } from "./tool-output-cache.js";

test("caches truncated output with a searchable path and removes expired files", async () => {
	const home = await mkdtemp("/tmp/yonder-output-");
	try {
		const streamed = await cacheToolOutput(
			home,
			"1",
			"web",
			{},
			(async function* () {
				yield Buffer.from("first\n");
				yield Buffer.from("last");
			})(),
		);
		expect(await readFile(streamed, "utf8")).toBe("first\nlast");
		expect(await readFile(join(home, "cache/tool-output/1/index.jsonl"), "utf8")).toContain('"bytes":10');
		await expect(
			cacheToolOutput(
				home,
				"1",
				"web",
				{},
				(async function* () {
					yield Buffer.from("partial");
					throw new Error("stream failed");
				})(),
			),
		).rejects.toThrow("stream failed");
		expect((await readdir(join(home, "cache/tool-output/1"))).sort()).toEqual(
			["index.jsonl", streamed.split("/").pop()].sort(),
		);
		const old = await cacheToolOutput(home, "1", "web", { url: "private" }, "old");
		const other = await cacheToolOutput(home, "2", "web", {}, "other session");
		const date = new Date(Date.now() - 8 * 86400_000);
		await utimes(old, date, date);
		await utimes(other, date, date);
		const text = `${"abc\n".repeat(2100)}END`;
		let path = "";
		const result = await boundToolOutput(
			text,
			async () => (path = await cacheToolOutput(home, "1", "web", { url: "private" }, text)),
		);
		expect(result).toContain(path);
		expect(result).toContain("read");
		expect(result).toContain("grep");
		expect(await readFile(path, "utf8")).toBe(text);
		await expect(readFile(old)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(other)).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readFile(join(home, "cache/tool-output/2/index.jsonl"), "utf8")).toBe("");
		await writeFile(join(home, "cache/tool-output.json"), JSON.stringify({ keepDays: 1 }));
		await utimes(path, new Date(Date.now() - 2 * 86400_000), new Date(Date.now() - 2 * 86400_000));
		await cacheToolOutput(home, "1", "web", {}, "new");
		await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
		const index = await readFile(join(home, "cache/tool-output/1/index.jsonl"), "utf8");
		expect(index).toContain('"args":[]');
		expect(index).not.toContain("private");
		expect(
			await boundToolOutput("small", () => {
				throw new Error("unexpected");
			}),
		).toBe("small");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
