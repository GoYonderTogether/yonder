import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
	chmod,
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
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { controlEndpoint, lockHome } from "@yonder/core";
import { moveInstall, planInstall } from "./migrate-install.js";
import { planServices, userServiceStopped } from "./migrate-services.js";
import { rewriteText, shellLine } from "./migrate-text.js";

const OLD_LABEL = "dev.yonder.harness.power";
const NEW_LABEL = "dev.yonder.power";

export { PLUGIN_RENAMES, rewriteText } from "./migrate-text.js";
export interface LaunchdPaths {
	daemons: string;
	helpers: string;
}
export interface MigrateOptions {
	oldHome: string;
	newHome: string;
	oldInstall?: string;
	newInstall?: string;
	platform?: NodeJS.Platform;
	/** launchd/systemd steps; off by default for any home that is not the real user's default one. */
	services?: boolean;
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
	installMoving: boolean;
	source?: string;
	backup?: string;
	rewrites: Array<{ file: string; count: number }>;
	renames: Array<{ from: string; to: string }>;
	commands: string[][];
}
export interface MigrationResult extends MigrationPlan {
	applied: boolean;
	launchdErrors: string[];
	/** launchd commands that ran / that did not run (the failed one first), separate from the data migration. */
	launchdDone: string[][];
	launchdPending: string[][];
}
export class MigrateError extends Error {}
export { defaultMigrateOptions } from "./migrate-defaults.js";

const execFileAsync = promisify(execFile);
const defaultRun = async (argv: string[]) => {
	const [file, ...args] = argv;
	if (file && !(await userServiceStopped(argv))) await execFileAsync(file, args);
};
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
export async function probe(path: string): Promise<Kind> {
	try {
		const info = await lstat(path);
		return info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "dir" : "other";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
		throw error;
	}
}
export { shellLine } from "./migrate-text.js";
export const exists = async (path: string) => (await probe(path)) !== "absent";
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
	const interrupted =
		Boolean(await findJournal(options)) ||
		Boolean(
			options.oldInstall &&
				options.newInstall &&
				(await findJournal({ oldHome: options.oldInstall, newHome: options.newInstall })),
		);
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

	const { oldInstall, newInstall } = options;
	const installMoving = await planInstall(options, conflicts);
	const found = source ? await inspectFiles(source, conflicts) : { rewrites: [], renames: [] };
	const lines: string[] = [];
	if (interrupted) lines.push(`发现上次中断的迁移（${JOURNAL}），--apply 会先收尾再继续`);
	const homeWork = moving || found.rewrites.length > 0 || found.renames.length > 0;
	const now = options.now ?? new Date();
	let backup: string | undefined;
	if ((homeWork && source) || installMoving) {
		const backupSource = source ?? (oldInstall as string);
		backup = await uniquePath(join(dirname(backupSource), `${basename(backupSource)}.backup-${stamp(now)}`));
		lines.push(`备份 ${backupSource} → ${backup}`);
	}
	if (installMoving) lines.push(`移动 ${oldInstall} → ${newInstall}，并在旧路径留符号链接`);
	if (moving) lines.push(`移动 ${oldHome} → ${newHome}，并在旧路径留符号链接`);
	for (const item of found.rewrites)
		lines.push(`改写 ${item.file}（${item.count} 处），原文件保留为 ${item.file}.pre-migrate-${stamp(now)}`);
	for (const item of found.renames) lines.push(`重命名 ${item.from} → ${item.to}`);

	const commands: string[][] = [];
	const serviceSteps = options.services !== false;
	if (serviceSteps && options.launchd) {
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
			for (const command of commands) lines.push(`  ${shellLine(command)}`);
		}
	}
	const planned = serviceSteps ? await planServices(options, conflicts) : [];
	if (planned.length) {
		lines.push("迁移用户服务标签：", ...planned.map((command) => `  ${shellLine(command)}`));
		commands.push(...planned);
	}
	if (!serviceSteps && lines.length) lines.push("跳过系统服务步骤（--no-service 或 home 不是默认安装路径）");
	const status = conflicts.length ? "blocked" : lines.length ? "ready" : "noop";
	return {
		status,
		conflicts,
		lines,
		moving,
		installMoving,
		...(source ? { source } : {}),
		...(backup ? { backup } : {}),
		rewrites: found.rewrites,
		renames: found.renames,
		commands,
	};
}

export const MANIFEST = "manifest.json";
export const JOURNAL = ".migrate-journal.json";
export const MTIME_SLACK_MS = 1000;
export interface Manifest {
	version: 1;
	date: string;
	oldHome: string;
	newHome: string;
	source: string;
	moved: boolean;
	oldInstall?: string;
	newInstall?: string;
	installMoved?: boolean;
	hasHome?: boolean;
	/** Set only once the data migration completed; rollback compares file mtimes against it. */
	finishedAt?: string;
}
interface Journal {
	version: 1;
	oldHome: string;
	newHome: string;
	tempLink: string;
	backup?: string;
}
export const suffix = () => randomBytes(4).toString("hex");

/**
 * The backup skips socket nodes and the lock directory on purpose. Sockets (control.sock, channel sockets such as
 * .yonder/plugins/channel-cli/*.sock) are runtime-only: a server recreates them on start and a copied node is dead.
 * The lock directory belongs to whoever holds it and must not be resurrected by a restore.
 */
export const copyTree = (from: string, to: string) =>
	cp(from, to, {
		recursive: true,
		preserveTimestamps: true,
		verbatimSymlinks: true,
		filter: async (path) => !(await lstat(path)).isSocket() && path !== join(from, ".yonder/lock"),
	});

async function writeKeepingMode(file: string, text: string) {
	const temporary = `${file}.${suffix()}.tmp`;
	try {
		const mode = (await stat(file)).mode & 0o777;
		await writeFile(temporary, text, { flag: "wx" });
		await chmod(temporary, mode);
		await rename(temporary, file);
	} finally {
		await rm(temporary, { force: true });
	}
}

/** Take the same home lock the service holds, so a server cannot start (or be running) mid-migration. */
export async function lockQuietly(home: string): Promise<(finalHome?: string) => Promise<void>> {
	await mkdir(join(home, ".yonder"), { recursive: true });
	let unlock: () => Promise<void>;
	try {
		// The directory is renamed under the lock; a failed heartbeat touch is expected there, not a crash.
		unlock = await lockHome(home, () => {});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOCKED")
			throw new MigrateError(`目录被服务占用（${home}），请先 yonder stop`);
		throw error;
	}
	return async (finalHome) => {
		await unlock().catch(() => {});
		if (finalHome) await rm(join(finalHome, ".yonder/lock"), { recursive: true, force: true });
	};
}

export async function assertStopped(homes: string[], running: (home: string) => Promise<boolean>) {
	for (const home of new Set(homes))
		if (await running(home)) throw new MigrateError(`服务正在运行（${home}），请先 yonder stop`);
}

async function readJournal(home: string): Promise<Journal | undefined> {
	try {
		const journal = JSON.parse(await readFile(join(home, JOURNAL), "utf8")) as Journal;
		return journal.version === 1 ? journal : undefined;
	} catch {
		return undefined;
	}
}
async function findJournal({ oldHome, newHome }: Pick<MigrateOptions, "oldHome" | "newHome">) {
	for (const home of [newHome, oldHome]) {
		const journal = await readJournal(home);
		if (journal && journal.oldHome === oldHome && journal.newHome === newHome) return { home, journal };
	}
	return undefined;
}
const ownTempLink = (journal: Journal) =>
	dirname(journal.tempLink) === dirname(journal.oldHome) &&
	basename(journal.tempLink).startsWith(`${basename(journal.oldHome)}.migrate-`);

/**
 * A crash between rename(old→new) and the symlink leaves new without a link at old. The journal says which half-done
 * state this is: still in old (nothing moved: drop it) or in new (moved: finish the link). Returns a note if it acted.
 */
async function recoverInterrupted(options: MigrateOptions, keepJournal = false): Promise<string | undefined> {
	const found = await findJournal(options);
	if (!found) return undefined;
	const { oldHome, newHome } = options;
	const { journal } = found;
	await assertStopped([oldHome, newHome], options.running ?? homeLocked);
	if (!ownTempLink(journal)) throw new MigrateError(`迁移日志无效，请人工检查：${join(found.home, JOURNAL)}`);
	if (found.home === newHome) {
		const kind = await probe(oldHome);
		if (kind === "absent") {
			if ((await probe(journal.tempLink)) === "symlink") await rename(journal.tempLink, oldHome);
			else await symlink(newHome, oldHome, process.platform === "win32" ? "junction" : "dir");
		} else if (kind !== "symlink" || (await realpath(oldHome).catch(() => "")) !== (await realpath(newHome)))
			throw new MigrateError(`上次迁移中断，且旧路径已被占用，请人工处理：${oldHome}`);
		await rm(journal.tempLink, { force: true });
		if (!keepJournal) await unlink(join(newHome, JOURNAL));
		return `已收尾上次中断的迁移：${oldHome} → ${newHome} 符号链接已补上`;
	}
	if ((await probe(newHome)) !== "absent") return undefined;
	await rm(journal.tempLink, { force: true });
	await unlink(join(oldHome, JOURNAL));
	return "已清理上次中断迁移留下的日志（数据未移动）";
}

export async function applyMigration(options: MigrateOptions): Promise<MigrationResult> {
	const running = options.running ?? homeLocked;
	const installOptions =
		options.oldInstall && options.newInstall
			? { ...options, oldHome: options.oldInstall, newHome: options.newInstall, running: async () => false }
			: undefined;
	if (installOptions && (await findJournal(installOptions)))
		await assertStopped([options.oldHome, options.newHome], running);
	const installJournal = installOptions ? await findJournal(installOptions) : undefined;
	const priorBackup =
		installJournal && installJournal.home === options.newInstall ? installJournal.journal.backup : undefined;
	const installRecovered = installOptions ? await recoverInterrupted(installOptions, Boolean(priorBackup)) : undefined;
	const recovered = (await recoverInterrupted(options)) ?? installRecovered;
	const plan = await planMigration(options);
	if (plan.status === "blocked") throw new MigrateError(`无法迁移：\n${plan.conflicts.join("\n")}`);
	if (plan.status === "noop")
		return {
			...plan,
			lines: recovered ? [recovered] : plan.lines,
			applied: recovered !== undefined,
			launchdErrors: [],
			launchdDone: [],
			launchdPending: [],
		};
	const date = stamp(options.now ?? new Date());
	const { oldHome, newHome } = options;
	let backup: string | undefined;
	let home = plan.source;
	const release = plan.source ? await lockQuietly(plan.source) : async () => {};
	const undo: Array<() => Promise<void>> = [];
	const scratch: string[] = [];
	let moved = false;
	try {
		await assertStopped([oldHome, newHome], running);
		try {
			if (priorBackup) backup = priorBackup;
			else if (plan.backup) {
				backup = await uniquePath(plan.backup);
				await mkdir(backup);
				if (plan.source) await copyTree(plan.source, join(backup, "home"));
				if (plan.installMoving && options.oldInstall) await copyTree(options.oldInstall, join(backup, "install"));
				const manifest: Manifest = {
					version: 1,
					date,
					oldHome,
					newHome,
					source: plan.source ?? (options.oldInstall as string),
					hasHome: Boolean(plan.source),
					...(plan.installMoving
						? { oldInstall: options.oldInstall, newInstall: options.newInstall, installMoved: true }
						: {}),
					moved: plan.moving,
				};
				await writeFile(join(backup, MANIFEST), `${JSON.stringify(manifest, null, "\t")}\n`);
			}
		} catch (error) {
			if (backup) await rm(backup, { recursive: true, force: true });
			throw error;
		}
		try {
			if (plan.installMoving) await moveInstall(options, undo, scratch, backup);
			if (plan.moving) {
				const tempLink = join(dirname(oldHome), `${basename(oldHome)}.migrate-${suffix()}`);
				scratch.push(tempLink);
				await mkdir(dirname(newHome), { recursive: true });
				const journal: Journal = { version: 1, oldHome, newHome, tempLink, ...(backup ? { backup } : {}) };
				await writeFile(join(oldHome, JOURNAL), `${JSON.stringify(journal, null, "\t")}\n`);
				undo.push(async () => {
					await rm(join(moved ? newHome : oldHome, JOURNAL), { force: true });
				});
				await symlink(newHome, tempLink, process.platform === "win32" ? "junction" : "dir");
				await assertStopped([oldHome, newHome], running);
				await rename(oldHome, newHome);
				moved = true;
				undo.push(async () => {
					if ((await probe(oldHome)) === "symlink") await unlink(oldHome);
					if ((await probe(oldHome)) === "absent") await rename(newHome, oldHome);
				});
				await rename(tempLink, oldHome);
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
					const original = await uniquePath(`${file}.pre-migrate-${date}`);
					await copyFile(file, original, constants.COPYFILE_EXCL);
					undo.unshift(() => rename(original, file));
					await writeKeepingMode(file, rewritten.text);
				}
				for (const item of plan.renames) {
					await rename(item.from, item.to);
					undo.unshift(() => rename(item.to, item.from));
				}
				if (moved) await unlink(join(home, JOURNAL));
			}
			if (backup)
				await writeFile(
					join(backup, MANIFEST),
					`${JSON.stringify({ ...(JSON.parse(await readFile(join(backup, MANIFEST), "utf8")) as Manifest), finishedAt: new Date().toISOString() }, null, "\t")}\n`,
				);
			if ((plan.installMoving || priorBackup) && options.newInstall)
				await rm(join(options.newInstall, JOURNAL), { force: true });
		} catch (error) {
			const failed: string[] = [];
			for (const step of undo)
				await step().catch((e: unknown) => failed.push(e instanceof Error ? e.message : String(e)));
			throw new MigrateError(
				`迁移中断，已${failed.length ? "尝试" : ""}还原：${error instanceof Error ? error.message : String(error)}${failed.length ? `\n还原未完全成功：${failed.join("；")}` : ""}${backup ? `\n可用 yonder migrate --rollback ${backup} 恢复；也可重跑 yonder migrate --apply 检查未完成状态` : ""}`,
			);
		}
	} finally {
		await Promise.all(scratch.map((path) => rm(path, { force: true })));
		await release(home);
	}
	const run = options.run ?? defaultRun;
	const launchdErrors: string[] = [];
	const launchdDone: string[][] = [];
	for (const command of plan.commands)
		try {
			await run(command);
			launchdDone.push(command);
		} catch (error) {
			launchdErrors.push(`${shellLine(command)}: ${error instanceof Error ? error.message : String(error)}`);
			break;
		}
	return {
		...plan,
		...(backup ? { backup } : {}),
		applied: true,
		launchdErrors,
		launchdDone,
		launchdPending: plan.commands.slice(launchdDone.length),
	};
}
