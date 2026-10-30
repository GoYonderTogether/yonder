import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { InstallPanel } from "../src/pages/Download";

afterEach(() => vi.unstubAllGlobals());

const render = () => renderToStaticMarkup(<InstallPanel />);

it("offers the one-line installer with a copy action on a desktop", () => {
	vi.stubGlobal("navigator", {
		userAgent:
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
		platform: "MacIntel",
		maxTouchPoints: 0,
	});
	const html = render();
	expect(html).toContain("macOS");
	expect(html).toContain("releases/latest/download/install.sh");
	expect(html).toContain('aria-label="复制 macOS 安装命令"');
	expect(html).toContain("添加设备");
});

it("offers a client download on a phone and a chooser when the system is unknown", () => {
	vi.stubGlobal("navigator", {
		userAgent:
			"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
		platform: "Linux armv8l",
		maxTouchPoints: 5,
	});
	const phone = render();
	expect(phone).toContain("下载安卓客户端");
	expect(phone).toContain("yonder-android.apk");

	vi.stubGlobal("navigator", { userAgent: "curl/8.7.1", platform: "", maxTouchPoints: 0 });
	const unknown = render();
	expect(unknown).toContain("选择要安装到哪台电脑");
	expect(unknown).toContain("Windows");
});
