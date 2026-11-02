import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { atomic } from "./persistence.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return { ...fs, rename: vi.fn(fs.rename) };
});
const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const platform = Object.getOwnPropertyDescriptor(process, "platform");
if (!platform) throw new Error("Missing process.platform descriptor");
afterEach(() => {
	Object.defineProperty(process, "platform", platform);
	vi.mocked(rename).mockReset().mockImplementation(fs.rename);
});

// Inject only OS rename failures; all file contents and atomic replacements use the real filesystem.
test.each(["EPERM", "EACCES", "EBUSY"])(
	"Windows retries transient %s without removing the old receipt",
	async (code) => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const dir = await mkdtemp(join(tmpdir(), "cron-atomic-"));
		const path = join(dir, "run.json");
		try {
			await writeFile(path, JSON.stringify({ status: "running" }));
			vi.mocked(rename).mockImplementationOnce(async (temp) => {
				expect(JSON.parse(await readFile(temp, "utf8"))).toEqual({ status: "done" });
				expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ status: "running" });
				throw Object.assign(new Error("temporarily locked"), { code });
			});
			await atomic(path, { status: "done" });
			expect(rename).toHaveBeenCalledTimes(2);
			expect(vi.mocked(rename).mock.calls[1]).toEqual(vi.mocked(rename).mock.calls[0]);
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ status: "done" });
			expect(await readdir(dir)).toEqual(["run.json"]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);

test.each([
	["win32", "EPERM", 6],
	["win32", "ENOSPC", 1],
	["linux", "EPERM", 1],
] as const)("%s permanent %s fails after %i attempts and preserves the receipt", async (os, code, attempts) => {
	Object.defineProperty(process, "platform", { value: os });
	const dir = await mkdtemp(join(tmpdir(), "cron-atomic-"));
	const path = join(dir, "run.json");
	const error = Object.assign(new Error("replacement failed"), { code });
	try {
		await writeFile(path, JSON.stringify({ status: "running" }));
		vi.mocked(rename).mockRejectedValue(error);
		await expect(atomic(path, { status: "done" })).rejects.toBe(error);
		expect(rename).toHaveBeenCalledTimes(attempts);
		for (const call of vi.mocked(rename).mock.calls) expect(call).toEqual(vi.mocked(rename).mock.calls[0]);
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ status: "running" });
		expect(await readdir(dir)).toEqual(["run.json"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("readers see complete receipts while the same run is atomically replaced", async () => {
	const dir = await mkdtemp(join(tmpdir(), "cron-atomic-"));
	const path = join(dir, "run.json");
	try {
		await atomic(path, { revision: 0 });
		await Promise.all([
			(async () => {
				for (let revision = 1; revision <= 30; revision++) await atomic(path, { revision });
			})(),
			(async () => {
				for (let i = 0; i < 100; i++) {
					const value = JSON.parse(await readFile(path, "utf8"));
					expect(value.revision).toBeGreaterThanOrEqual(0);
					expect(value.revision).toBeLessThanOrEqual(30);
				}
			})(),
		]);
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ revision: 30 });
		expect(await readdir(dir)).toEqual(["run.json"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
