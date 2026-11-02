import { access } from "node:fs/promises";
import { win32 } from "node:path";
import { chromium } from "playwright-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { detectBrowser } from "../src/browser.js";

vi.mock("node:fs/promises", async (original) => ({
	...(await original<typeof import("node:fs/promises")>()),
	access: vi.fn(),
}));

const roots = {
	PROGRAMFILES: "C:\\Program Files",
	"PROGRAMFILES(X86)": "C:\\Program Files (x86)",
	LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local",
};
const cached = "C:\\playwright\\chromium\\chrome.exe";
beforeEach(() => {
	vi.spyOn(process, "platform", "get").mockReturnValue("win32");
	for (const [key, value] of Object.entries(roots)) vi.stubEnv(key, value);
	vi.spyOn(chromium, "executablePath").mockReturnValue(cached);
	vi.mocked(access).mockReset().mockRejectedValue(new Error("ENOENT"));
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

for (const root of Object.values(roots)) {
	for (const browser of ["Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"]) {
		it(`detects installed ${browser} under ${root} without a Playwright download`, async () => {
			const installed = win32.join(root, browser);
			vi.mocked(access).mockImplementation(async (path) => {
				if (path !== installed) throw new Error("ENOENT");
			});
			expect(await detectBrowser()).toBe(installed);
			expect(access).not.toHaveBeenCalledWith(cached);
		});
	}
}
it("uses the Playwright fallback with missing Windows environment roots", async () => {
	for (const key of Object.keys(roots)) vi.stubEnv(key, undefined);
	vi.mocked(access).mockResolvedValue(undefined);
	expect(await detectBrowser()).toBe(cached);
	expect(access).toHaveBeenCalledExactlyOnceWith(cached);
});
it("returns unavailable when no installed or cached browser exists", async () => {
	expect(await detectBrowser()).toBeUndefined();
	expect(access).toHaveBeenLastCalledWith(cached);
});
it.each([
	["darwin", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
	["linux", "/usr/bin/chromium"],
] as const)("retains %s browser discovery", async (platform, installed) => {
	vi.spyOn(process, "platform", "get").mockReturnValue(platform);
	vi.mocked(access).mockImplementation(async (path) => {
		if (path !== installed) throw new Error("ENOENT");
	});
	expect(await detectBrowser()).toBe(installed);
});
