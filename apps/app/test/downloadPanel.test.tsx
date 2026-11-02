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
	// 两种入口：只装核心，或核心 + 桌面应用（同一支脚本带 --desktop）。
	expect(html).toContain("只装核心");
	expect(html).toContain("核心 + 桌面应用");
	expect(html).toContain("--desktop");
	expect(html).toContain('aria-label="复制 macOS 桌面应用安装命令"');
	expect(html).toContain("关闭桌面应用后核心继续运行");
	expect(html).toContain("同时把核心装成后台服务，关掉窗口后继续运行");
	expect(html).toContain("添加设备");
});

it("keeps the core-only command on Linux and offers the desktop bundle on Windows", () => {
	vi.stubGlobal("navigator", {
		userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
		platform: "Linux x86_64",
		maxTouchPoints: 0,
	});
	const linux = render();
	expect(linux).toContain("install.sh");
	expect(linux).not.toContain("--desktop");

	vi.stubGlobal("navigator", {
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
		platform: "Win32",
		maxTouchPoints: 0,
	});
	const windows = render();
	expect(windows).toContain("install.ps1");
	expect(windows).toContain("-Desktop");
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
