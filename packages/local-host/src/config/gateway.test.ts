import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setAccessTokenHash } from "@yonder/local-host/config/gateway";
import { parseYonderConfig } from "@yonder/local-host/config/index";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return { ...fs, rename: vi.fn(fs.rename), rm: vi.fn(fs.rm) };
});

const renameMock = vi.mocked(rename);
const realRename = renameMock.getMockImplementation();
const rmMock = vi.mocked(rm);
const realRm = rmMock.getMockImplementation();
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
let home: string | undefined;

afterEach(async () => {
	if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
	renameMock.mockClear();
	if (realRename) renameMock.mockImplementation(realRename);
	rmMock.mockClear();
	if (realRm) rmMock.mockImplementation(realRm);
	if (home) await rm(home, { recursive: true, force: true });
	home = undefined;
});

async function setup() {
	const targetHome = await mkdtemp(join(tmpdir(), "yonder-gateway-config-"));
	home = targetHome;
	const file = join(targetHome, "yonder.yaml");
	await writeFile(file, "schema: 1\n");
	return { home: targetHome, file };
}

function setPlatform(platform: string) {
	if (!originalPlatform) throw new Error("process.platform descriptor unavailable");
	Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
}

const temporaryEperm = () => Object.assign(new Error("temporary sharing violation"), { code: "EPERM" });

it("retries transient Windows EPERM while atomically rotating the access token hash", async () => {
	const { home, file } = await setup();
	setPlatform("win32");
	renameMock.mockRejectedValueOnce(temporaryEperm()).mockRejectedValueOnce(temporaryEperm());

	await setAccessTokenHash(home, `sha256:${"a".repeat(64)}`);

	expect(renameMock).toHaveBeenCalledTimes(3);
	expect(parseYonderConfig(await readFile(file, "utf8"), file).gateway?.accessTokenHash).toBe(
		`sha256:${"a".repeat(64)}`,
	);
});

it("stops after six Windows rename attempts and keeps the original config", async () => {
	const { home, file } = await setup();
	const original = await readFile(file, "utf8");
	setPlatform("win32");
	renameMock.mockRejectedValue(temporaryEperm());

	await expect(setAccessTokenHash(home, `sha256:${"b".repeat(64)}`)).rejects.toMatchObject({ code: "EPERM" });

	expect(renameMock).toHaveBeenCalledTimes(6);
	expect(await readFile(file, "utf8")).toBe(original);
});

it("does not retry EPERM outside Windows and keeps the original config", async () => {
	const { home, file } = await setup();
	const original = await readFile(file, "utf8");
	setPlatform("darwin");
	renameMock.mockRejectedValue(temporaryEperm());

	await expect(setAccessTokenHash(home, `sha256:${"c".repeat(64)}`)).rejects.toMatchObject({ code: "EPERM" });

	expect(renameMock).toHaveBeenCalledTimes(1);
	expect(await readFile(file, "utf8")).toBe(original);
});

it("keeps the rename error primary and exposes temp cleanup failure", async () => {
	const { home, file } = await setup();
	const original = await readFile(file, "utf8");
	setPlatform("darwin");
	const renameError = temporaryEperm();
	const cleanupError = new Error("temp cleanup failed");
	renameMock.mockRejectedValueOnce(renameError);
	rmMock.mockRejectedValueOnce(cleanupError);

	let thrown: unknown;
	try {
		await setAccessTokenHash(home, `sha256:${"d".repeat(64)}`);
	} catch (error) {
		thrown = error;
	}

	expect(thrown).toBeInstanceOf(AggregateError);
	expect((thrown as AggregateError).cause).toBe(renameError);
	expect((thrown as AggregateError).errors).toEqual([renameError, cleanupError]);
	expect(renameMock).toHaveBeenCalledTimes(1);
	expect(await readFile(file, "utf8")).toBe(original);
});
