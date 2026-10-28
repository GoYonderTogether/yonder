import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdout } from "node:process";
import { installedService, manageService } from "@yonder/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { uninstall } from "./uninstall.js";

vi.mock("@yonder/core", async (original) => ({
	...(await original<typeof import("@yonder/core")>()),
	installedService: vi.fn(),
	manageService: vi.fn(),
}));

let root: string, install: string, home: string, helper: string;
let output: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "yonder-uninstall-"));
	install = join(root, "install");
	home = join(root, ".local/share/yonder/home");
	helper = join(root, ".local/share/yonder/helper");
	vi.stubEnv("HOME", root);
	vi.stubEnv("USERPROFILE", root);
	vi.stubEnv("YONDER_INSTALL", install);
	vi.stubEnv("YONDER_HOME", undefined);
	vi.stubEnv("LOCALAPPDATA", join(root, "AppData/Local"));
	vi.stubEnv("XDG_CONFIG_HOME", join(root, ".config"));
	vi.mocked(installedService).mockResolvedValue(undefined);
	vi.mocked(manageService).mockResolvedValue({ installed: false, loaded: false });
	output = vi.spyOn(stdout, "write").mockReturnValue(true);
	for (const path of [install, home, helper]) {
		await mkdir(path, { recursive: true });
		await writeFile(join(path, "retained.txt"), "keep");
	}
	// Use the installed service home, also on Windows, without inspecting real services.
	vi.mocked(installedService).mockResolvedValue({ home, install, plist: join(root, "service") });
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	await rm(root, { recursive: true, force: true });
});

test("default uninstall prints its plan before stopping service and keeps home and helper", async () => {
	vi.mocked(manageService).mockImplementation(async () => {
		expect(output).toHaveBeenCalled();
		expect(existsSync(install)).toBe(true);
		return { installed: false, loaded: false };
	});
	expect(await uninstall([])).toBe(0);
	expect(manageService).toHaveBeenCalledWith("uninstall");
	expect(existsSync(install)).toBe(false);
	expect(await readFile(join(home, "retained.txt"), "utf8")).toBe("keep");
	expect(existsSync(helper)).toBe(true);
	expect(output.mock.calls[0]?.[0]).toContain("数据/凭据");
	expect(output.mock.calls[0]?.[0]).toContain("代码");
});

test("purge deletes home and helper and repeated uninstall succeeds", async () => {
	expect(await uninstall(["--purge"])).toBe(0);
	vi.mocked(installedService).mockResolvedValue(undefined);
	expect(await uninstall(["--purge"])).toBe(0);
	for (const path of [install, home, helper]) expect(existsSync(path)).toBe(false);
	expect(manageService).toHaveBeenCalledTimes(2);
});

test("keep-home overrides purge while helper is removed", async () => {
	expect(await uninstall(["--purge", "--keep-home"])).toBe(0);
	expect(existsSync(home)).toBe(true);
	expect(existsSync(helper)).toBe(false);
});

test("dry-run JSON prints paths without changing files or services", async () => {
	expect(await uninstall(["--purge", "--dry-run", "--json"])).toBe(0);
	const plan = JSON.parse(String(output.mock.calls[0]?.[0]));
	expect(plan).toMatchObject({ dryRun: true, data: [home], code: [install, helper], keptHome: null });
	for (const path of [install, home, helper]) expect(await readFile(join(path, "retained.txt"), "utf8")).toBe("keep");
	expect(manageService).not.toHaveBeenCalled();
});

test.each(["npm", "brew", "scoop", "docker"])(
	"%s install keeps package and prints uninstall command",
	async (installedBy) => {
		await writeFile(join(install, ".yonder-install.json"), JSON.stringify({ installedBy }));
		expect(await uninstall(["--purge"], true)).toBe(0);
		expect(existsSync(install)).toBe(true);
		expect(existsSync(home)).toBe(false);
		const plan = JSON.parse(String(output.mock.calls[0]?.[0]));
		expect(plan.installedBy).toBe(installedBy);
		expect(plan.code).not.toContain(install);
		expect(plan.hints.join("\n")).toContain(installedBy);
		expect(manageService).toHaveBeenCalledWith("uninstall");
	},
);

test("reads legacy current metadata and keeps package data by default", async () => {
	await mkdir(join(install, "current"));
	await writeFile(join(install, "current/.yonder-install.json"), '{"installedBy":"npm"}');
	expect(await uninstall([])).toBe(0);
	expect(existsSync(install)).toBe(true);
	expect(existsSync(home)).toBe(true);
});

test("home nested in install survives default removal", async () => {
	const nested = join(install, "home");
	await mkdir(nested);
	await writeFile(join(nested, "auth.json"), "keep");
	expect(await uninstall([], false, nested)).toBe(0);
	expect(await readFile(join(nested, "auth.json"), "utf8")).toBe("keep");
	expect(existsSync(join(install, "retained.txt"))).toBe(false);
});

test("service failure preserves all files", async () => {
	vi.mocked(manageService).mockRejectedValue(new Error("stop failed"));
	await expect(uninstall(["--purge"])).rejects.toThrow("stop failed");
	for (const path of [install, home, helper]) expect(existsSync(path)).toBe(true);
});

test("invalid flags fail without stopping service", async () => {
	await expect(uninstall(["--unknown"])).rejects.toThrow("Usage:");
	expect(manageService).not.toHaveBeenCalled();
});
