import { expect, it } from "vitest";
import { clientDownload, detectPlatform, installCommand, installTarget } from "../src/lib/platform";

const UA = {
	macos:
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
	windows:
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
	linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
	android:
		"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
	iphone:
		"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
	ipad: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

it("identifies the device that opened the page", () => {
	expect(detectPlatform(UA.macos, "MacIntel")).toBe("macos");
	expect(detectPlatform(UA.windows, "Win32")).toBe("windows");
	expect(detectPlatform(UA.linux, "Linux x86_64")).toBe("linux");
	expect(detectPlatform(UA.android, "Linux armv8l")).toBe("android");
	expect(detectPlatform(UA.iphone, "iPhone")).toBe("ios");
	expect(detectPlatform(UA.ipad, "iPad")).toBe("ios");
	expect(detectPlatform("curl/8.7.1")).toBe("other");
});

it("gives desktops one command that installs the latest release", () => {
	for (const platform of ["macos", "linux"] as const) {
		const target = installTarget(platform);
		expect(target).toMatchObject({ kind: "command", platform });
		expect(installCommand(platform)).toContain("releases/latest/download/install.sh");
		expect(installCommand(platform)).toContain("| sh");
	}
	const windows = installTarget("windows");
	expect(windows).toMatchObject({ kind: "command", platform: "windows" });
	expect(installCommand("windows")).toContain("releases/latest/download/install.ps1");
	expect(installCommand("windows")).toContain("| iex");
});

it("gives phones a client download and unknown systems a chooser", () => {
	expect(installTarget("android")).toMatchObject({ kind: "client", href: clientDownload.android });
	expect(installTarget("ios")).toMatchObject({ kind: "client", href: clientDownload.ios });
	expect(installTarget("other")).toEqual({ kind: "choose" });
});
