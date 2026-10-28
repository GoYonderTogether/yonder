import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
	copyFile,
	cp,
	lstat,
	mkdir,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { controlEndpoint } from "@yonder/core";

/** User-data migration for `yonder migrate` (design §3.4). It never touches repo source. */
export const PLUGIN_RENAMES: ReadonlyArray<readonly [string, string]> = [
	["hermes-experience", "learning"],
	["ui-companion", "interaction"],
];
const OLD_LABEL = "dev.yonder.harness.power";
const NEW_LABEL = "dev.yonder.power";
// Dash goes last so it is a literal, not a range ("@-_" would swallow "[").
const TOKEN = "A-Za-z0-9./@-";

const rules = PLUGIN_RENAMES.flatMap(([from, to]) => [
	[new RegExp(`@yonder/plugin-${from}(?![${TOKEN}])`, "gu"), `@yonder/plugin-${to}`] as const,
	// Underscore may follow (tool names such as hermes-experience_recall) but not precede.
	[new RegExp(`(?<![A-Za-z0-9./@_-])${from}(?![${TOKEN}])`, "gu"), to] as const,
]);

export function rewriteText(text: string): { text: string; count: number } {
	let count = 0;
	let result = text;
	for (const [pattern, replacement] of rules)
		result = result.replace(pattern, () => {
			count++;
			return replacement;
		});
	return { text: result, count };
}

export interface LaunchdPaths {
	daemons: string;
	helpers: string;
}
export interface MigrateOptions {
	oldHome: string;
	newHome: string;
	now?: Date;
	launchd?: LaunchdPaths;
	run?: (argv: string[]) => Promise<void>;
	running?: (home: string) => Promise<boolean>;
}
export interface MigrationPlan {
	status: "noop" | "ready" | "blocked";
	conflicts: string[];
	lines: string[];
	moving: boolean;
	source?: string;
	backup?: string;
	rewrites: Array<{ file: string; count: number }>;
	renames: Array<{ from: string; to: string }>;
	commands: string[][];
}
export interface MigrationResult extends MigrationPlan {
	applied: boolean;
	launchdErrors: string[];
}
export class MigrateError extends Error {}

export function defaultMigrateOptions(): MigrateOptions {
	const share = join(homedir(), ".local/share");
	return {
		oldHome: join(share, "yonder-harness/home"),
		newHome: join(share, "yonder/home"),
		...(process.platform === "darwin"
			? { launchd: { daemons: "/Library/LaunchDaemons", helpers: "/Library/PrivilegedHelperTools" } }
			: {}),
	};
}

const execFileAsync = promisify(execFile);
const defaultRun = async (argv: string[]) => {
	const [file, ...args] = argv;
	if (file) await execFileAsync(file, args);
};
/** A live server owns the control socket; a stale socket file refuses the connection. */
export function homeLocked(home: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection(controlEndpoint(home));
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
	});
}

type Kind = "absent" | "dir" | "symlink" | "other";
async function probe(path: string): Promise<Kind> {
	try {
		const info = await lstat(path);
		return info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "dir" : "other";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
		throw error;
	}
}
const exists = async (path: string) => (await probe(path)) !== "absent";
const stamp = (now: Date) => now.toISOString().slice(0, 10).replaceAll("-", "");

async function uniquePath(base: string): Promise<string> {
	if (!(await exists(base))) return base;
	for (let n = 2; ; n++) if (!(await exists(`${base}-${n}`))) return `${base}-${n}`;
}

async function yamlFiles(home: string): Promise<string[]> {
	const files = [join(home, "yonder.yaml")];
	try {
		for (const entry of await readdir(join(home, "agents"), { withFileTypes: true }))
			if (entry.isFile() && entry.name.endsWith(".yaml")) files.push(join(home, "agents", entry.name));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return files;
}
async function inspectFiles(home: string, conflicts: string[]) {
	const rewrites: MigrationPlan["rewrites"] = [];
	for (const file of await yamlFiles(home)) {
		let text: string;
		try {
			text = await readFile(file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		const { count } = rewriteText(text);
		if (count) rewrites.push({ file, count });
	}
	const renames: MigrationPlan["renames"] = [];
	const from = join(home, ".yonder/plugins/hermes-experience");
	const to = join(home, ".yonder/plugins/learning");
	if (await exists(from)) {
		if (await exists(to)) conflicts.push(`插件状态目录已存在，无法重命名：${from} → ${to}`);
		else renames.push({ from, to });
	}
	return { rewrites, renames };
}

export async function planMigration(options: MigrateOptions): Promise<MigrationPlan> {
	const { oldHome, newHome } = options;
	const running = options.running ?? homeLocked;
	const conflicts: string[] = [];
	for (const home of new Set([oldHome, newHome]))
		if (await running(home)) conflicts.push(`服务正在运行（${home}），请先 yonder stop`);
	const oldKind = await probe(oldHome);
	const newKind = await probe(newHome);
	let moving = false;
	let source: string | undefined;
	if (newKind === "symlink" || newKind === "other") conflicts.push(`新路径不是目录：${newHome}`);
	else if (oldKind === "dir") {
		if (newKind === "dir") conflicts.push(`新旧路径都是真实目录，请人工处理：${oldHome} 与 ${newHome}`);
		else {
			moving = true;
			source = oldHome;
		}
	} else if (oldKind === "symlink") {
		const target = await realpath(oldHome).catch(() => undefined);
		const expected = await realpath(newHome).catch(() => undefined);
		if (target && target === expected) source = newHome;
		else conflicts.push(`旧路径是符号链接但不指向 ${newHome}：${oldHome}`);
	} else if (oldKind === "other") conflicts.push(`旧路径不是目录：${oldHome}`);
	else if (newKind === "dir") source = newHome;

	const found = source ? await inspectFiles(source, conflicts) : { rewrites: [], renames: [] };
	const lines: string[] = [];
	const homeWork = moving || found.rewrites.length > 0 || found.renames.length > 0;
	const now = options.now ?? new Date();
	let backup: string | undefined;
	if (homeWork && source) {
		backup = await uniquePath(join(dirname(source), `${basename(source)}.backup-${stamp(now)}`));
		lines.push(`备份 ${source} → ${backup}/home`);
	}
	if (moving) lines.push(`移动 ${oldHome} → ${newHome}，并在旧路径留符号链接`);
	for (const item of found.rewrites)
		lines.push(`改写 ${item.file}（${item.count} 处），原文件保留为 ${item.file}.pre-migrate-${stamp(now)}`);
	for (const item of found.renames) lines.push(`重命名 ${item.from} → ${item.to}`);

	const commands: string[][] = [];
	if (options.launchd) {
		const { daemons, helpers } = options.launchd;
		const oldPlist = join(daemons, `${OLD_LABEL}.plist`);
		const newPlist = join(daemons, `${NEW_LABEL}.plist`);
		if ((await exists(oldPlist)) && !(await exists(newPlist))) {
			commands.push(["launchctl", "bootout", `system/${OLD_LABEL}`]);
			if (await exists(join(helpers, OLD_LABEL)))
				commands.push(["mv", join(helpers, OLD_LABEL), join(helpers, NEW_LABEL)]);
			commands.push(["sed", "-i", "", `s/dev\\.yonder\\.harness\\.power/${NEW_LABEL}/g`, oldPlist]);
			commands.push(["mv", oldPlist, newPlist]);
			commands.push(["launchctl", "bootstrap", "system", newPlist]);
			lines.push(`launchd 标签 ${OLD_LABEL} → ${NEW_LABEL}（需管理员权限；仅 --apply 时执行）：`);
			for (const command of commands) lines.push(`  ${command.map((part) => (part === "" ? "''" : part)).join(" ")}`);
		}
	}
	const status = conflicts.length ? "blocked" : lines.length ? "ready" : "noop";
	return {
		status,
		conflicts,
		lines,
		moving,
		...(source ? { source } : {}),
		...(backup ? { backup } : {}),
		rewrites: found.rewrites,
		renames: found.renames,
		commands,
	};
}

const MANIFEST = "manifest.json";
interface Manifest {
	version: 1;
	date: string;
	oldHome: string;
	newHome: string;
	source: string;
	moved: boolean;
}
const notSocket = async (path: string) => !(await lstat(path)).isSocket();
const copyTree = (from: string, to: string) =>
	cp(from, to, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, filter: notSocket });

async function writeKeepingMode(file: string, text: string) {
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, text, { mode: (await stat(file)).mode & 0o777 });
	await rename(temporary, file);
}

export async function applyMigration(options: MigrateOptions): Promise<MigrationResult> {
	const plan = await planMigration(options);
	if (plan.status === "blocked") throw new MigrateError(`无法迁移：\n${plan.conflicts.join("\n")}`);
	if (plan.status === "noop") return { ...plan, applied: false, launchdErrors: [] };
	const date = stamp(options.now ?? new Date());
	const { oldHome, newHome } = options;
	const launchdErrors: string[] = [];
	let home = plan.source;
	if (plan.backup && plan.source) {
		await mkdir(plan.backup, { recursive: true });
		await copyTree(plan.source, join(plan.backup, "home"));
		const manifest: Manifest = {
			version: 1,
			date,
			oldHome,
			newHome,
			source: plan.source,
			moved: plan.moving,
		};
		await writeFile(join(plan.backup, MANIFEST), `${JSON.stringify(manifest, null, "\t")}\n`);
	}
	try {
		if (plan.moving) {
			await mkdir(dirname(newHome), { recursive: true });
			await rename(oldHome, newHome);
			await symlink(newHome, oldHome);
			home = newHome;
		}
		if (home) {
			for (const file of await yamlFiles(home)) {
				let text: string;
				try {
					text = await readFile(file, "utf8");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
					throw error;
				}
				const rewritten = rewriteText(text);
				if (!rewritten.count) continue;
				await copyFile(file, await uniquePath(`${file}.pre-migrate-${date}`), constants.COPYFILE_EXCL);
				await writeKeepingMode(file, rewritten.text);
			}
			for (const item of plan.renames) await rename(item.from, item.to);
		}
	} catch (error) {
		throw new MigrateError(
			`迁移中断：${error instanceof Error ? error.message : String(error)}${plan.backup ? `\n可用 yonder migrate --rollback ${plan.backup} 恢复` : ""}`,
		);
	}
	const run = options.run ?? defaultRun;
	for (const command of plan.commands)
		try {
			await run(command);
		} catch (error) {
			launchdErrors.push(`${command.join(" ")}: ${error instanceof Error ? error.message : String(error)}`);
			break;
		}
	return { ...plan, applied: true, launchdErrors };
}

export async function rollbackMigration(
	backup: string,
	options: Pick<MigrateOptions, "running"> & { apply?: boolean } = {},
): Promise<{ restored: string; lines: string[]; applied: boolean }> {
	let manifest: Manifest;
	try {
		manifest = JSON.parse(await readFile(join(backup, MANIFEST), "utf8")) as Manifest;
	} catch {
		throw new MigrateError(`不是有效的迁移备份：${backup}`);
	}
	if (manifest.version !== 1 || !(await exists(join(backup, "home"))))
		throw new MigrateError(`不是有效的迁移备份：${backup}`);
	const running = options.running ?? homeLocked;
	for (const home of new Set([manifest.oldHome, manifest.newHome]))
		if (await running(home)) throw new MigrateError(`服务正在运行（${home}），请先 yonder stop`);
	const lines: string[] = [];
	const kind = await probe(manifest.oldHome);
	if (manifest.moved) {
		if (kind !== "symlink" && kind !== "absent")
			throw new MigrateError(`旧路径已存在真实内容，拒绝覆盖：${manifest.oldHome}`);
		lines.push(`移除 ${manifest.newHome} 与旧路径符号链接`);
	} else lines.push(`清空 ${manifest.source}`);
	lines.push(`从 ${backup}/home 恢复 ${manifest.source}（迁移后产生的新数据会丢失）`);
	lines.push("launchd 标签改名不会自动回滚；如已执行，请手动恢复旧标签");
	if (!options.apply) return { restored: manifest.source, lines, applied: false };
	if (manifest.moved) {
		if (kind === "symlink") await unlink(manifest.oldHome);
		await rm(manifest.newHome, { recursive: true, force: true });
	} else await rm(manifest.source, { recursive: true, force: true });
	await mkdir(dirname(manifest.source), { recursive: true });
	await copyTree(join(backup, "home"), manifest.source);
	return { restored: manifest.source, lines, applied: true };
}
