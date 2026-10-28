import { lstat, mkdir, readdir, readFile, realpath, rename, rm, symlink, unlink } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import {
	assertStopped,
	copyTree,
	exists,
	homeLocked,
	JOURNAL,
	lockQuietly,
	MANIFEST,
	type Manifest,
	MigrateError,
	type MigrateOptions,
	type MigrationResult,
	MTIME_SLACK_MS,
	probe,
	shellLine,
	suffix,
} from "./migrate.js";

/** Data migration and launchd are reported apart: data can be done while the launchd steps still need a human. */
export function formatMigration(result: MigrationResult): string {
	if (!result.applied) return "无需迁移 · Nothing to migrate";
	const out = [...result.lines, "数据迁移：已完成"];
	if (result.commands.length) {
		if (!result.launchdPending.length) out.push("launchd：已全部执行");
		else {
			out.push(
				`launchd：已执行 ${result.launchdDone.length}/${result.commands.length} 条${result.launchdErrors.length ? `，失败：${result.launchdErrors.join("；")}` : ""}`,
				"数据不受影响。请在管理员终端按顺序执行剩余命令（失败的一条在最前）：",
				...result.launchdPending.map((command) => `  sudo ${shellLine(command)}`),
			);
		}
	}
	return out.join("\n");
}

async function newerFiles(dir: string, since: number): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const path = join(entry.parentPath, entry.name);
		if (relative(dir, path) === JOURNAL) continue;
		if ((await lstat(path)).mtimeMs > since) out.push(relative(dir, path));
	}
	return out;
}

export async function rollbackMigration(
	backup: string,
	options: Pick<MigrateOptions, "running"> & { apply?: boolean; force?: boolean } = {},
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
	const homes = [manifest.oldHome, manifest.newHome];
	await assertStopped(homes, running);
	// What gets removed must be exactly what this backup produced.
	const target = manifest.moved ? manifest.newHome : manifest.source;
	if (manifest.moved) {
		const link = (await probe(manifest.oldHome)) === "symlink" ? await realpath(manifest.oldHome).catch(() => "") : "";
		if (!link || link !== (await realpath(manifest.newHome).catch(() => undefined)))
			throw new MigrateError(
				`拒绝回滚：旧路径 ${manifest.oldHome} 不是指向 ${manifest.newHome} 的符号链接，状态已被改动，请人工处理`,
			);
	} else if ((await probe(target)) !== "dir") throw new MigrateError(`拒绝回滚：${target} 不是目录`);
	if (manifest.finishedAt && !options.force) {
		const newer = await newerFiles(target, Date.parse(manifest.finishedAt) + MTIME_SLACK_MS);
		if (newer.length)
			throw new MigrateError(
				`拒绝回滚：${target} 中有 ${newer.length} 个文件比备份新（迁移后写入的数据），回滚会丢失它们：${newer.slice(0, 5).join("、")}${newer.length > 5 ? " …" : ""}\n确认可丢弃后加 --force`,
			);
	}
	const lines: string[] = [];
	lines.push(
		`先把 ${backup}/home 恢复到临时目录，再原子换入，最后才删除${manifest.moved ? `新目录 ${manifest.newHome} 与旧路径符号链接` : `原目录 ${target}`}`,
	);
	lines.push(`迁移后产生的新数据会丢失${options.force ? "（--force）" : ""}`);
	lines.push("launchd 标签改名不会自动回滚；如已执行，请手动恢复旧标签");
	if (!options.apply) return { restored: manifest.source, lines, applied: false };
	const release = await lockQuietly(target);
	const place = manifest.moved ? manifest.oldHome : target;
	const restoring = join(dirname(place), `${basename(place)}.restore-${suffix()}`);
	try {
		await copyTree(join(backup, "home"), restoring);
		await assertStopped(homes, running);
		if (manifest.moved) {
			await unlink(manifest.oldHome);
			try {
				await rename(restoring, manifest.oldHome);
			} catch (error) {
				await symlink(manifest.newHome, manifest.oldHome, process.platform === "win32" ? "junction" : "dir");
				throw error;
			}
			await rm(manifest.newHome, { recursive: true, force: true });
		} else {
			const aside = `${target}.replaced-${suffix()}`;
			await rename(target, aside);
			try {
				await rename(restoring, target);
			} catch (error) {
				await rename(aside, target);
				throw error;
			}
			await rm(aside, { recursive: true, force: true });
		}
	} finally {
		await rm(restoring, { recursive: true, force: true });
		await release();
	}
	return { restored: manifest.source, lines, applied: true };
}
