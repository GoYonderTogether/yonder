import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { MigrateOptions } from "./migrate.js";

const present = async (path: string) =>
	lstat(path).then(
		() => true,
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return false;
			throw error;
		},
	);

/** Plan user service migration without invoking the service manager. */
export async function planServices(options: MigrateOptions, conflicts: string[]): Promise<string[][]> {
	const platform = options.platform ?? process.platform;
	if ((platform !== "darwin" && platform !== "linux") || !options.oldInstall) return [];
	const userHome = dirname(options.oldInstall);
	const dir =
		platform === "darwin"
			? join(userHome, "Library/LaunchAgents")
			: join(resolve(process.env.XDG_CONFIG_HOME ?? join(userHome, ".config")), "systemd/user");
	const labels = ["dev.yonder.harness", "dev.yonder.harness.status", "dev.yonder.harness.service"];
	const entries = labels.map((label) => ({
		label,
		file: join(dir, `${label}${platform === "darwin" ? ".plist" : ""}`),
	}));
	const found = [];
	for (const entry of entries) {
		const original = await present(entry.file);
		const staged = await present(`${entry.file}.migrate`);
		if (original && staged) conflicts.push(`旧服务文件和迁移暂存文件同时存在，请人工处理：${entry.file}`);
		if (original || staged) found.push({ ...entry, original, staged });
	}
	if (!found.length) return [];
	const newLabels =
		platform === "darwin" ? ["dev.yonder.service.plist", "dev.yonder.status.plist"] : ["dev.yonder.service"];
	if (!found.some((entry) => entry.staged))
		for (const label of newLabels)
			if (await present(join(dir, label))) conflicts.push(`新服务定义已存在，请人工处理：${join(dir, label)}`);
	const install = options.newInstall;
	if (!install) {
		conflicts.push("旧服务存在，但未指定新安装目录，请人工处理");
		return [];
	}
	const commands: string[][] = [];
	for (const { label, file, original } of found) {
		if (!original) continue;
		commands.push(
			platform === "darwin"
				? ["launchctl", "bootout", `gui/${process.getuid?.()}/${label}`]
				: ["systemctl", "--user", "disable", "--now", label],
			["mv", file, `${file}.migrate`],
		);
	}
	commands.push([
		"env",
		`YONDER_INSTALL=${install}`,
		process.execPath,
		join(dirname(fileURLToPath(import.meta.url)), "index.js"),
		"service",
		"install",
		"--home",
		options.newHome,
	]);
	for (const { file } of found) commands.push(["rm", "-f", `${file}.migrate`]);
	if (platform === "linux") commands.push(["systemctl", "--user", "daemon-reload"]);
	return commands;
}

/** A stopped launchd job need not be booted out. */
export async function userServiceStopped(argv: string[]): Promise<boolean> {
	if (argv[0] !== "launchctl" || argv[1] !== "bootout" || !argv[2]?.startsWith("gui/")) return false;
	try {
		await promisify(execFile)("launchctl", ["print", argv[2]]);
		return false;
	} catch {
		return true;
	}
}
