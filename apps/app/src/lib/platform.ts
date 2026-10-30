export type Platform = "macos" | "windows" | "linux" | "android" | "ios" | "other";

/** 识别访问者当前设备：Android 先于 Linux 判断（UA 里同时含 Linux），iPadOS 13+ 以 MacIntel + 触屏出现。 */
export function detectPlatform(userAgent: string, platform?: string): Platform {
	const ua = userAgent.toLowerCase();
	if (/android/u.test(ua)) return "android";
	if (/iphone|ipod/u.test(ua)) return "ios";
	if (/ipad/u.test(ua)) return "ios";
	if (platform === "MacIntel" && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1) return "ios";
	if (/win/u.test(ua) || /^win/u.test(platform ?? "")) return "windows";
	if (/mac os x|macintosh|^mac/u.test(ua) || /^mac/u.test(platform ?? "")) return "macos";
	if (/linux|x11|ubuntu|fedora|debian/u.test(ua) || /^linux/u.test(platform ?? "")) return "linux";
	return "other";
}

export const platformName: Record<Platform, string> = {
	macos: "macOS",
	windows: "Windows",
	linux: "Linux",
	android: "Android",
	ios: "iOS",
	other: "未知系统",
};

const RELEASE = "https://github.com/GoYonderTogether/yonder/releases/latest/download";

/** 一键安装命令：随 Release 发布的 install.sh / install.ps1，固定指向最新正式版。 */
export const installCommand = (platform: Platform) =>
	platform === "windows" ? `irm ${RELEASE}/install.ps1 | iex` : `curl -fsSL ${RELEASE}/install.sh | sh`;

/** 手机客户端：仓库目前没有安卓/iOS 产物，地址按发布约定预留，产物上线即生效。 */
export const clientDownload = {
	android: `${RELEASE}/yonder-android.apk`,
	ios: "https://testflight.apple.com/join/yonder",
} as const;

export type InstallTarget =
	| { kind: "command"; platform: Platform; label: string; command: string }
	| { kind: "client"; platform: "android" | "ios"; label: string; href: string }
	| { kind: "choose" };

/** 安装页要展示的东西：电脑给命令，手机给客户端下载，识别不了时让人自己选。 */
export function installTarget(platform: Platform): InstallTarget {
	if (platform === "macos" || platform === "windows" || platform === "linux")
		return { kind: "command", platform, label: platformName[platform], command: installCommand(platform) };
	if (platform === "android" || platform === "ios")
		return { kind: "client", platform, label: platformName[platform], href: clientDownload[platform] };
	return { kind: "choose" };
}
