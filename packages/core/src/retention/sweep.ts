import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat, truncate } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { RetentionPolicy } from "./policy.js";
import { emptyResult, type SweepResult } from "./report.js";

export interface SweepDeps {
	policy: RetentionPolicy;
	/** 派生物回收：调用方实现（与具体数据库无关），返回实际处理条数。 */
	compactDerived?: (olderThanDays: number, budgetBytes: number) => Promise<number>;
	now?: () => number;
}

const DAY_MS = 86_400_000;
/** 归档名固定为 `<base>.<紧凑 ISO 时间戳>.log`，用来把归档和活跃日志区分开。 */
const ARCHIVE_NAME = /\.\d{8}T\d{9}Z\.log$/;

export function createSweep(deps: SweepDeps): { run(): Promise<SweepResult> } {
	const now = deps.now ?? Date.now;
	let inflight: Promise<SweepResult> | null = null;
	return {
		run() {
			// 重入保护：定时器和手动命令可能同时触发。
			// 并发调用共享同一轮结果，而不是排队——排队会让积压的轮次接着删刚写下的东西。
			if (!inflight) {
				inflight = sweep(deps, now).finally(() => {
					inflight = null;
				});
			}
			return inflight;
		},
	};
}

async function sweep(deps: SweepDeps, now: () => number): Promise<SweepResult> {
	const startedAt = now();
	const result = emptyResult(startedAt);
	const budget = new Budget(deps.policy.budgetBytes);
	try {
		await rotateLogs(deps.policy, now(), result, budget);
		await mergeBackground(deps.policy, now(), result, budget);
		await rotateMerged(deps.policy, now(), result, budget);
	} catch (error) {
		// 顶层兜底：保留任务不能把宿主服务打挂，未预期的错误也只记一条。
		result.skipped.push({ what: "sweep", reason: message(error) });
	}
	if (deps.compactDerived) {
		try {
			// 传剩余预算：日志与后台合并已经用掉的部分不能重复花掉。
			result.derivedCompacted = await deps.compactDerived(deps.policy.derived.olderThanDays, budget.left());
		} catch (error) {
			result.skipped.push({ what: "derived", reason: message(error) });
		}
	}
	result.durationMs = now() - startedAt;
	return result;
}

/** 单轮字节预算。单个对象就超预算时仍放行一次，否则超大对象会让每轮空转。 */
class Budget {
	#spent = 0;
	constructor(private readonly limit: number) {}
	take(bytes: number) {
		if (this.limit <= 0 || (this.#spent > 0 && this.#spent + bytes > this.limit)) return false;
		this.#spent += bytes;
		return true;
	}
	left() {
		return Math.max(0, this.limit - this.#spent);
	}
}

/** 日志轮转：只处理活跃文件，归档自己不会再被轮转一次。 */
async function rotateLogs(policy: RetentionPolicy, at: number, result: SweepResult, budget: Budget) {
	const dir = policy.logs.dir;
	const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
		if (!isMissing(error)) result.skipped.push({ what: dir, reason: message(error) });
		return [];
	});
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.name.endsWith(".log") || ARCHIVE_NAME.test(entry.name)) continue;
		const file = join(dir, entry.name);
		// 合并文件由 rotateMerged 单独轮转，避免落在 logs 目录时被处理两次。
		if (resolve(file) === resolve(policy.background.mergedFile)) continue;
		try {
			if (!entry.isFile()) {
				result.skipped.push({ what: file, reason: "不是普通文件，跳过" });
				continue;
			}
			const size = (await stat(file)).size;
			if (size <= policy.logs.maxBytes) continue;
			if (!budget.take(size)) {
				result.skipped.push({ what: file, reason: "超出单轮预算，留到下一轮" });
				continue;
			}
			await rotateOne(file, policy, at, result);
		} catch (error) {
			result.skipped.push({ what: file, reason: message(error) });
		}
	}
}

async function rotateOne(file: string, policy: RetentionPolicy, at: number, result: SweepResult) {
	const dir = dirname(file);
	const base = basename(file, ".log");
	const archive = join(dir, `${base}.${stamp(at)}.log`);
	// 不做 rename：写入方持有的是 fd，rename 后它会继续写进已改名的文件，原路径消失、
	// 新建的同名文件永远空着。复制 + 截断保住原 inode，写入方的 fd 依然有效；
	// 复制整个文件而不是只留尾部，因为日志头部没有别处副本。
	await copyFile(file, archive);
	await truncate(file, 0);
	result.logsRotated.push(archive);
	await pruneArchives(dir, base, policy.logs.keep, result);
}

async function pruneArchives(dir: string, base: string, keep: number, result: SweepResult) {
	const pattern = new RegExp(`^${escapeRegExp(base)}\\.\\d{8}T\\d{9}Z\\.log$`);
	const archives: Array<{ file: string; mtime: number }> = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !pattern.test(entry.name)) continue;
		const file = join(dir, entry.name);
		archives.push({ file, mtime: (await stat(file)).mtimeMs });
	}
	// 按写入时间倒序；同一轮复制出的归档 mtime 可能相同，用文件名兜底保证顺序稳定。
	archives.sort((a, b) => b.mtime - a.mtime || b.file.localeCompare(a.file));
	for (const old of archives.slice(keep)) {
		try {
			const size = (await stat(old.file)).size;
			await rm(old.file, { force: true });
			result.logsRemoved.push(old.file);
			result.bytesReclaimed += size;
		} catch (error) {
			result.skipped.push({ what: old.file, reason: message(error) });
		}
	}
}

/**
 * 合并文件轮转：与 logs 目录共用 maxBytes 和 keep。
 *
 * 合并文件在后台目录之外，`rotateLogs` 扫不到；不轮转的话它会把所有历史
 * 后台输出永久累积成一个越来越大的文件。
 */
async function rotateMerged(policy: RetentionPolicy, at: number, result: SweepResult, budget: Budget) {
	const file = policy.background.mergedFile;
	let size: number;
	try {
		size = (await stat(file)).size;
	} catch (error) {
		if (!isMissing(error)) result.skipped.push({ what: file, reason: message(error) });
		return;
	}
	if (size <= policy.logs.maxBytes) return;
	if (!budget.take(size)) {
		result.skipped.push({ what: file, reason: "超出单轮预算，留到下一轮" });
		return;
	}
	try {
		await rotateOne(file, policy, at, result);
	} catch (error) {
		result.skipped.push({ what: file, reason: message(error) });
	}
}

/** 后台目录合并：先写进滚动文件，确认成功后再删目录，避免内容丢失。 */
async function mergeBackground(policy: RetentionPolicy, at: number, result: SweepResult, budget: Budget) {
	const dir = policy.background.dir;
	const entries = await readdir(dir, { withFileTypes: true }).catch((error: unknown) => {
		if (!isMissing(error)) result.skipped.push({ what: dir, reason: message(error) });
		return [];
	});
	const cutoff = at - policy.background.keepDays * DAY_MS;
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.isDirectory()) continue;
		const sub = join(dir, entry.name);
		try {
			const info = await stat(sub);
			const bytes = await dirBytes(sub);
			if (info.mtimeMs < cutoff) {
				// 超过保留期：内容要么早已进入滚动文件，要么本来就该丢。
				await rm(sub, { recursive: true, force: true });
				result.backgroundDirsRemoved += 1;
				result.backgroundBytesRemoved += bytes;
				result.bytesReclaimed += bytes;
				continue;
			}
			if (!budget.take(bytes)) {
				result.skipped.push({ what: sub, reason: "超出单轮预算，留到下一轮" });
				continue;
			}
			await mergeDir(sub, policy.background.mergedFile, at);
			await rm(sub, { recursive: true, force: true });
			result.backgroundDirsRemoved += 1;
			result.backgroundBytesRemoved += bytes;
		} catch (error) {
			result.skipped.push({ what: sub, reason: message(error) });
		}
	}
}

async function mergeDir(dir: string, mergedFile: string, at: number) {
	const files = (await readdir(dir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
		.sort((a, b) => a.name.localeCompare(b.name));
	if (files.length === 0) return;
	await mkdir(dirname(mergedFile), { recursive: true });
	const when = new Date(at).toISOString();
	for (const file of files) {
		const content = await readFile(join(dir, file.name), "utf8");
		// 分隔行带目录名和文件名，合并后仍能还原每条输出的来源。
		const header = `\n=== ${basename(dir)}/${file.name} ${when} ===\n`;
		await appendFile(mergedFile, header + content + (content.endsWith("\n") ? "" : "\n"), "utf8");
	}
}

async function dirBytes(dir: string): Promise<number> {
	let total = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		total += entry.isDirectory() ? await dirBytes(path) : (await stat(path)).size;
	}
	return total;
}

/** 紧凑 ISO（去掉分隔符）便于字典序排序，也避免文件名里的冒号。 */
const stamp = (at: number) => new Date(at).toISOString().replace(/[-:.]/g, "");
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
