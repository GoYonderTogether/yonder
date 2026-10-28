import { lstat, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stdout } from "node:process";
import { installedService, manageService, releaseInfo } from "@yonder/core";

const usage = "Usage: yonder uninstall [--purge] [--keep-home] [--json] [--dry-run]";
const packageCommands: Record<string, string> = {
	npm: "npm uninstall -g @yonder/cli",
	brew: "brew uninstall goyondertogether/tap/yonder",
	scoop: "scoop uninstall yonder",
	docker: "docker stop <container>; docker rm <container>; docker image rm <image>",
	app: "请使用系统的应用卸载功能 · Uninstall the application with your OS",
};
const contains = (parent: string, child: string) => {
	const path = relative(parent, child);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
};

// Windows can keep home inside the install prefix. Keep its ancestors as well.
async function removeCode(path: string, keep?: string): Promise<void> {
	if (path === keep) return;
	if (keep && contains(path, keep)) {
		try {
			if (!(await lstat(path)).isSymbolicLink()) {
				for (const entry of await readdir(path)) await removeCode(join(path, entry), keep);
				return;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
	await rm(path, { recursive: true, force: true });
}

export async function uninstall(args: string[], json = false, selectedHome?: string): Promise<number> {
	if (args.some((arg) => !["--purge", "--keep-home", "--dry-run", "--json"].includes(arg))) throw new Error(usage);
	json ||= args.includes("--json");
	const purge = args.includes("--purge"),
		keepHome = !purge || args.includes("--keep-home"),
		dryRun = args.includes("--dry-run");
	const info = await releaseInfo(),
		service = await installedService(),
		install = resolve(process.env.YONDER_INSTALL ?? service?.install ?? info.install),
		user = homedir(),
		home = resolve(
			selectedHome ??
				process.env.YONDER_HOME ??
				service?.home ??
				(process.platform === "win32"
					? join(process.env.LOCALAPPDATA ?? join(user, "AppData/Local"), "YonderHarness/home")
					: join(user, ".local/share/yonder/home")),
		),
		helper = join(user, ".local/share/yonder/helper");
	if (install === dirname(install) || install === user || (!keepHome && (home === dirname(home) || home === user)))
		throw new Error("Refusing to remove the user directory or filesystem root");
	let installedBy = info.origin?.installedBy ?? "script";
	for (const file of [join(install, ".yonder-install.json"), join(install, "current/.yonder-install.json")]) {
		try {
			installedBy = JSON.parse(await readFile(file, "utf8")).installedBy ?? "script";
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	if (installedBy !== "script" && !Object.hasOwn(packageCommands, installedBy))
		throw new Error(`Unknown installedBy: ${installedBy}`);
	if (installedBy !== "script" && !keepHome && contains(home, install))
		throw new Error("Refusing to purge a home containing a package-managed installation");
	const data = keepHome ? [] : [home];
	const code = [...(installedBy === "script" ? [install] : []), ...(purge ? [helper] : [])];
	const services =
		process.platform === "darwin"
			? ["dev.yonder.harness", "dev.yonder.harness.status"].map((label) =>
					join(user, "Library/LaunchAgents", `${label}.plist`),
				)
			: process.platform === "linux"
				? [join(process.env.XDG_CONFIG_HOME ?? join(user, ".config"), "systemd/user/dev.yonder.harness.service")]
				: [
						"Scheduled task: Yonder Harness",
						join(process.env.LOCALAPPDATA ?? join(user, "AppData/Local"), "YonderHarness/service.json"),
					];
	const hints = [
		...(installedBy === "script" ? [] : [packageCommands[installedBy]]),
		"请从 shell 配置或用户 PATH 中移除 Yonder 的手工 PATH 项 · Remove manual Yonder PATH entries",
		...(purge && process.platform === "darwin"
			? [
					"管理员手动执行 · Run manually as administrator: sudo launchctl bootout system/dev.yonder.power",
					"sudo rm -f /Library/PrivilegedHelperTools/dev.yonder.power /Library/LaunchDaemons/dev.yonder.power.plist /var/run/dev.yonder.power.sock",
				]
			: []),
	];
	const plan = { dryRun, installedBy, data, code, services, keptHome: keepHome ? home : null, hints };
	stdout.write(
		json
			? `${JSON.stringify(plan)}\n`
			: `${[
					`卸载计划 · Uninstall${dryRun ? " (dry-run)" : ""}`,
					"数据/凭据 · Data/credentials:",
					...data,
					...(keepHome ? [`保留 · Keep: ${home}`] : []),
					"代码 · Code:",
					...code,
					"服务 · Services:",
					...services,
					...hints,
				].join("\n")}\n`,
	);
	if (dryRun) return 0;
	await manageService("uninstall");
	for (const path of data) await rm(path, { recursive: true, force: true });
	for (const path of code) await removeCode(path, keepHome ? home : undefined);
	return 0;
}
