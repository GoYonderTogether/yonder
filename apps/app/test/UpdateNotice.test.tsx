import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { UpdateNotice } from "../src/work/ui/UpdateNotice";

test.each([
	{ basePath: "/", expectedPath: "/version.json" },
	{ basePath: "/console/", expectedPath: "/console/version.json" },
])("checks for updates under mount $basePath on focus and every five minutes", async ({ basePath, expectedPath }) => {
	const { window } = parseHTML(
		`<html><head><meta name='yonder-base-path' content='${basePath}'></head><body><div id='root'></div></body></html>`,
	);
	vi.useFakeTimers();
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("location", new URL(`https://yonderbot.net${basePath}work`));
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubEnv("VITE_BUILD_VERSION", "1");
	vi.stubEnv("VITE_BUILD_COMMIT", "old");
	const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "1", commit: "old" }) });
	vi.stubGlobal("fetch", fetch);
	const container = window.document.getElementById("root") as unknown as HTMLElement;
	const root = createRoot(container);
	try {
		await act(async () => root.render(<UpdateNotice />));
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(new URL(`https://yonderbot.net${expectedPath}`), { cache: "no-store" });
		await act(async () => vi.advanceTimersByTimeAsync(300_000));
		expect(fetch).toHaveBeenCalledTimes(2);
		fetch.mockResolvedValue({ ok: true, json: async () => ({ version: "1", commit: "new" }) });
		await act(async () => window.dispatchEvent(new window.Event("focus")));
		expect(container.textContent).toContain("有新版本，刷新");
		expect(container.querySelector("button")).not.toBeNull();
	} finally {
		await act(async () => root.unmount());
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	}
});
