import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { command } from "@yonder/local-host/release/exec";
import { windowsStatusExecutable, windowsStatusScript, windowsStatusTask } from "@yonder/local-host/release/paths";

/**
 * Windows 常驻状态栏图标的自启动接入（spec 09 §6，与 macOS 状态栏对齐）。
 *
 * 为什么是独立登录任务而不是启动文件夹快捷方式：安装后端本来就是 Task Scheduler 登录任务，
 * `schtasks` 是这里唯一已有的系统接口；任务同样只属于当前用户、不用管理员权限，且可以在
 * `service uninstall` 时确定地删除，而启动文件夹里的 .lnk 需要 WScript.Shell 才能清理。
 * 它不依赖服务任务，也不随服务退出被重拉（RunAtLoad 语义，没有 KeepAlive）。
 *
 * 状态栏自己只读 `yonder service info --json`，与 macOS 相同：不建第二份状态存储、不读凭据、
 * 不发系统通知。安装目录缺产物（回退到旧版本目录）时跳过自启动，不假装安装成功。
 */
const QUERY = ["/Query"];

const task = (args: string[], allowFailure = false) =>
	command("schtasks.exe", [...args, "/TN", windowsStatusTask], { allowFailure });

export async function windowsStatusAvailable(install: string): Promise<boolean> {
	try {
		await access(windowsStatusExecutable(install));
		await access(join(install, "bin/yonder.cmd"));
		return true;
	} catch {
		return false;
	}
}

/** `<install>/bin/yonder-status.cmd` 只保存 home/install 两个路径；错误输出进状态栏日志，便于排查。 */
export function windowsStatusLauncher(install: string, home: string, executable = windowsStatusExecutable(install)) {
	const value = (path: string) => {
		if (/["%\r\n^&|<>]/u.test(path))
			throw new Error("Windows status paths must not contain quotes, percent or shell metacharacters");
		return path;
	};
	return `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${value(executable)}" --install "${value(install)}" --home "${value(home)}" >> "${value(join(home, ".yonder", "logs", "status.log"))}" 2>&1\r\n`;
}

export async function installedStatusTask(): Promise<boolean> {
	return (await task(QUERY, true)).code === 0;
}

/**
 * 注册用户级登录任务 `Yonder Status` 并立刻运行。已存在的任务先结束再覆盖，
 * 避免旧进程带着旧 home 继续跑；`/RL LIMITED` 表示以当前用户的普通权限运行。
 *
 * 返回 `"unavailable"` 表示这次安装没有状态栏产物（例如回退到旧版本目录），
 * 调用方据此如实报告，不把“跳过”当成“已安装”。
 */
export async function installWindowsStatus(install: string, home: string): Promise<"installed" | "unavailable"> {
	if (!(await windowsStatusAvailable(install))) return "unavailable";
	const script = windowsStatusScript(install);
	const commandLine = `"${script}"`;
	if (commandLine.includes("%") || commandLine.includes("\r") || commandLine.includes("\n"))
		throw new Error("Windows status task script path must not contain percent or line breaks");
	if (commandLine.length > 262) throw new Error("Windows status task command exceeds the 262-character /TR limit");
	await writeFile(script, windowsStatusLauncher(install, home));
	if ((await task(QUERY, true)).code === 0) await task(["/End"], true);
	await task(["/Create", "/SC", "ONLOGON", "/TR", commandLine, "/F", "/RL", "LIMITED"]);
	await task(["/Run"]);
	return "installed";
}

/**
 * `service uninstall`：删除登录任务与启动脚本。不碰 home、版本目录与服务任务。
 * 调用方传入实际安装目录——`service.json` 在清理顺序里可能已经不在了。
 */
export async function uninstallWindowsStatus(install: string): Promise<void> {
	if ((await task(QUERY, true)).code === 0) {
		await task(["/End"], true);
		await task(["/Delete", "/F"]);
	}
	await rm(windowsStatusScript(install), { force: true });
}

/**
 * `service start` / `restart` 让图标重新出现（老机器升级到带图标版本后不必重装一次）。
 * 图标已在运行时这里会再触发一次任务；第二个进程拿不到 home 的锁就退出，不会出现两个图标。
 */
export async function startWindowsStatus(): Promise<void> {
	if ((await task(QUERY, true)).code !== 0) return;
	await task(["/Run"], true);
}

/** `service status` 如实报告图标是否已注册；只回答任务存在与否，不读任务定义里的命令。 */
export async function windowsStatusInstalled(): Promise<boolean> {
	return installedStatusTask();
}
