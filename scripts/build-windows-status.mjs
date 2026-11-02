import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Windows 托盘（packages/windows-status）只在 Windows 上编译，并且要求机器上已有 .NET SDK。
// 其余平台显式跳过并说明原因：这里不产出替代文件，也不假装构建成功。
// 产物 packages/windows-status/dist/ 在 .gitignore 的 dist/ 范围内；安装目录里的
// current junction 会引用它，与 macOS 的 YonderStatus.app 同一约定。

const ROOT = resolve(import.meta.dirname, "..");
const PROJECT = join(ROOT, "packages/windows-status/YonderStatus.csproj");
const OUT = join(ROOT, "packages/windows-status/dist");
const BRAND = join(ROOT, "brand/assets/png");

/** `dotnet build` 的参数：框架依赖（不打包运行时），关掉 ReadyToRun，两个架构产物一致。 */
export function dotnetArgs(project = PROJECT, output = OUT) {
	return ["build", project, "-c", "Release", "-o", output];
}

/** 把仓库 brand 资源拷到 exe 旁边：托盘按系统主题在墨色/白色 mark 之间选择。 */
export function copyBrandAssets(from = BRAND, to = OUT) {
	mkdirSync(to, { recursive: true });
	for (const [source, output] of [
		["yonder-mark-512.png", "yonder-mark.png"],
		["yonder-mark-white-512.png", "yonder-mark-white.png"],
	])
		copyFileSync(join(from, source), join(to, output));
}

export function buildWindowsStatus() {
	if (process.platform !== "win32") {
		console.log(
			`跳过 Windows 状态栏构建：process.platform 是 ${process.platform}，只有 Windows 宿主能编译 WinForms 托盘。`,
		);
		return "skipped";
	}
	const check = spawnSync("dotnet", ["--version"], { stdio: "ignore" });
	if (check.error || check.status !== 0) {
		// 用户机器可能只有 .NET 运行时、没有 SDK：安装不能因此失败，但也不能把跳过说成构建成功。
		// 状态栏产物不存在时 `service install` 会如实报 statusIcon: unavailable，而不是假装装上了图标。
		const reason = "Windows 状态栏未构建：没有 .NET SDK（dotnet），本次安装不含状态栏图标。";
		if (process.env.YONDER_REQUIRE_WINDOWS_STATUS === "1") throw new Error(reason);
		console.log(reason);
		return "skipped";
	}
	const build = spawnSync("dotnet", dotnetArgs(), { cwd: ROOT, stdio: "inherit" });
	if (build.error) throw build.error;
	if (build.status !== 0) throw new Error("Windows 状态栏构建失败");
	const built = join(OUT, "YonderStatus.exe");
	if (!existsSync(built)) throw new Error(`Windows 状态栏构建没有产出 ${built}`);
	mkdirSync(OUT, { recursive: true });
	copyBrandAssets();
	console.log("Windows 状态栏已构建：packages/windows-status/dist/YonderStatus.exe");
	return "built";
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) buildWindowsStatus();
