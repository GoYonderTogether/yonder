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
const INSTALL_SH = `${RELEASE}/install.sh`;
const INSTALL_PS1 = `${RELEASE}/install.ps1`;

/** 一键安装核心：随 Release 发布的 install.sh / install.ps1，固定指向最新正式版。 */
export const installCommand = (platform: Platform) =>
	platform === "windows" ? `irm ${INSTALL_PS1} | iex` : `curl -fsSL ${INSTALL_SH} | sh`;

/** 已发布桌面安装包的系统；Linux 的 deb/appimage 还没随 Release 构建。 */
export const hasDesktopPackage = (platform: Platform): platform is "macos" | "windows" =>
	platform === "macos" || platform === "windows";

/** 核心 + 桌面应用：同一条安装脚本带 `--desktop` / `-Desktop`；脚本先装核心，再装桌面应用并常驻后台服务。 */
export const desktopInstallCommand = (platform: "macos" | "windows") =>
	platform === "windows"
		? `& ([scriptblock]::Create((irm ${INSTALL_PS1}))) -Desktop`
		: `curl -fsSL ${INSTALL_SH} | sh -s -- --desktop`;

/** 手机客户端：仓库目前没有安卓/iOS 产物，地址按发布约定预留，产物上线即生效。 */
export const clientDownload = {
	android: `${RELEASE}/yonder-android.apk`,
	ios: "https://testflight.apple.com/join/yonder",
} as const;

export type DesktopInstall = { label: string; command: string; note: string };
export type InstallTarget =
	| { kind: "command"; platform: Platform; label: string; command: string; desktop?: DesktopInstall }
	| { kind: "client"; platform: "android" | "ios"; label: string; href: string }
	| { kind: "choose" };

/** 安装页要展示的东西：电脑给两段命令（只装核心 / 核心 + 桌面），手机给客户端下载，识别不了时让人自己选。 */
export function installTarget(platform: Platform): InstallTarget {
	if (platform === "macos" || platform === "windows" || platform === "linux") {
		const desktop = hasDesktopPackage(platform)
			? {
					label: "核心 + 桌面应用",
					command: desktopInstallCommand(platform),
					note: "先装好本机核心，再装桌面应用（/Applications 或开始菜单），并把核心装成后台服务；关闭桌面应用后核心继续运行，核心停止时桌面应用回落到云端站点。",
				}
			: undefined;
		return {
			kind: "command",
			platform,
			label: platformName[platform],
			command: installCommand(platform),
			...(desktop ? { desktop } : {}),
		};
	}
	if (platform === "android" || platform === "ios")
		return { kind: "client", platform, label: platformName[platform], href: clientDownload[platform] };
	return { kind: "choose" };
}
