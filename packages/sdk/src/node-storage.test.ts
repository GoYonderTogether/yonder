import { mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createFilePluginStorage } from "./node-storage.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return { ...fs, rename: vi.fn(fs.rename) };
});
const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const platform = Object.getOwnPropertyDescriptor(process, "platform");
if (!platform) throw new Error("Missing process.platform descriptor");
const directories: string[] = [];

afterEach(async () => {
	Object.defineProperty(process, "platform", platform);
	vi.mocked(rename).mockReset().mockImplementation(fs.rename);
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "plugin-storage-atomic-"));
	directories.push(directory);
	return { directory, files: createFilePluginStorage(directory).open() };
}

test.each(["EPERM", "EACCES", "EBUSY"])(
	"Windows retries transient %s and preserves the complete old file",
	async (code) => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const { directory, files } = await fixture();
		const path = join(directory, "run.json");
		await files.write("run.json", JSON.stringify({ status: "running" }));
		const targetRenames: Array<{ from: string; to: string }> = [];
		vi.mocked(rename).mockImplementation(async (from, to) => {
			if (to === path) {
				targetRenames.push({ from: String(from), to: String(to) });
				if (targetRenames.length === 1) {
					expect(JSON.parse(await readFile(String(from), "utf8"))).toEqual({ status: "done" });
					expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ status: "running" });
					throw Object.assign(new Error("temporarily locked"), { code });
				}
			}
			return fs.rename(from, to);
		});

		await files.write("run.json", JSON.stringify({ status: "done" }));
		expect(targetRenames).toHaveLength(2);
		expect(targetRenames[1]).toEqual(targetRenames[0]);
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ status: "done" });
		expect(await readdir(directory)).toEqual(["run.json"]);
	},
);

test.each([
	["win32", "EPERM", 6],
	["win32", "ENOSPC", 1],
	["linux", "EPERM", 1],
] as const)("%s permanent %s fails after %i target renames and preserves the receipt", async (os, code, attempts) => {
	Object.defineProperty(process, "platform", { value: os });
	const { directory, files } = await fixture();
	const path = join(directory, "run.json");
	const error = Object.assign(new Error("replacement failed"), { code });
	await files.write("run.json", JSON.stringify({ status: "running" }));
	const targetRenames: Array<{ from: string; to: string }> = [];
	vi.mocked(rename).mockImplementation(async (from, to) => {
		if (to === path) {
			targetRenames.push({ from: String(from), to: String(to) });
			throw error;
		}
		return fs.rename(from, to);
	});

	await expect(files.write("run.json", JSON.stringify({ status: "done" }))).rejects.toBe(error);
	expect(targetRenames).toHaveLength(attempts);
	expect(targetRenames.every((call) => call.to === path && call.from === targetRenames[0]?.from)).toBe(true);
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ status: "running" });
	expect(await readdir(directory)).toEqual(["run.json"]);
});

test("readers see complete receipts while the same plugin file is transactionally replaced", async () => {
	const { files } = await fixture();
	await files.write("run.json", JSON.stringify({ revision: 0 }));
	await Promise.all([
		(async () => {
			for (let revision = 1; revision <= 30; revision++) await files.write("run.json", JSON.stringify({ revision }));
		})(),
		(async () => {
			for (let i = 0; i < 100; i++) {
				const value = JSON.parse((await files.read("run.json")) ?? "null") as { revision: number };
				expect(value.revision).toBeGreaterThanOrEqual(0);
				expect(value.revision).toBeLessThanOrEqual(30);
			}
		})(),
	]);
	expect(JSON.parse((await files.read("run.json")) ?? "null")).toEqual({ revision: 30 });
});

test("a failed multi-file transaction restores every file and removes transaction artifacts", async () => {
	const { directory, files } = await fixture();
	await files.write("a.json", "old a");
	await files.write("b.json", "old b");
	const path = join(directory, "b.json");
	const error = Object.assign(new Error("replacement failed"), { code: "EIO" });
	let failed = false;
	vi.mocked(rename).mockImplementation(async (from, to) => {
		if (to === path && !failed) {
			failed = true;
			throw error;
		}
		return fs.rename(from, to);
	});

	await expect(
		files.transaction(async (tx) => {
			await tx.write("a.json", "new a");
			await tx.write("b.json", "new b");
		}),
	).rejects.toBe(error);
	expect(await files.read("a.json")).toBe("old a");
	expect(await files.read("b.json")).toBe("old b");
	expect((await readdir(directory)).sort()).toEqual(["a.json", "b.json"]);
});
