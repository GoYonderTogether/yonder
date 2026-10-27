import { createHash } from "node:crypto";

/**
 * 派生物正文回收。
 *
 * 对象：`yonder.background` 终态任务的 `state.outcome`。
 * 依据：这些正文是后台任务的完整输出，同一份文本已经在会话转录 `pi_entries` 里
 * （本机抽样 12/12 命中，见 proposals/runtime-efficiency/checklist.md 第 0 节）。
 * 所以剥离正文是去重，不是丢数据。
 *
 * 保留：`state.status`、原文字节数、sha256、首尾各 2 KB。
 * 拿到摘要就能判断"当时成功没有、输出多大、前后长什么样"，
 * 需要全文时去转录里取。
 */

const HEAD_BYTES = 2048;
const TAIL_BYTES = 2048;
/** 小于这个长度的正文不值得处理：省不下空间，还多一次写。 */
const MIN_BYTES = 4096;

/** 只依赖这三个方法，方便测试注入。参数类型与内核 Db 保持一致，避免接线时再包一层。 */
type Param = null | number | bigint | string | Uint8Array;
export interface CompactionDb {
	all<T extends object>(sql: string, ...params: Param[]): Promise<T[]>;
	run(sql: string, ...params: Param[]): Promise<void>;
}

export interface CompactionSummary {
	compacted: number;
	bytesBefore: number;
	bytesAfter: number;
	bytesReclaimed: number;
	skipped: number;
}

interface Candidate {
	id: number;
	record: string;
}

function slice(value: string, bytes: number, fromEnd: boolean): string {
	// 按字符近似字节：中文 3 字节，宁可少切也不要越界。
	const limit = Math.max(0, Math.floor(bytes / 3));
	return fromEnd ? value.slice(-limit) : value.slice(0, limit);
}

/**
 * 生成一次压缩计划并执行。
 * `apply=false` 时只统计不写库，用于预览。
 */
export async function compactBackgroundOutcomes(
	db: CompactionDb,
	options: {
		olderThanDays: number;
		budgetBytes: number;
		now?: number;
		apply?: boolean;
		limit?: number;
	},
): Promise<CompactionSummary> {
	const now = options.now ?? Date.now();
	const cutoff = now - options.olderThanDays * 86_400_000;
	const limit = options.limit ?? 200;
	// kind 在库里是带引号的 JSON 字符串，必须按存储值匹配。
	const candidates = await db.all<Candidate>(
		`SELECT id, record FROM pi_tasks
		 WHERE kind = '"yonder.background"'
		   AND status = 'terminal'
		   AND LENGTH(record) > ?
		   AND CAST(json_extract(record, '$.endedAt') AS INTEGER) < ?
		 ORDER BY LENGTH(record) DESC
		 LIMIT ?`,
		MIN_BYTES,
		cutoff,
		limit,
	);

	const summary: CompactionSummary = {
		compacted: 0,
		bytesBefore: 0,
		bytesAfter: 0,
		bytesReclaimed: 0,
		skipped: 0,
	};

	for (const row of candidates) {
		if (summary.bytesReclaimed >= options.budgetBytes) {
			summary.skipped += candidates.length - summary.compacted - summary.skipped;
			break;
		}
		let record: Record<string, unknown>;
		try {
			record = JSON.parse(row.record) as Record<string, unknown>;
		} catch {
			summary.skipped += 1;
			continue;
		}
		const state = record.state;
		if (!state || typeof state !== "object") {
			summary.skipped += 1;
			continue;
		}
		const outcome = (state as Record<string, unknown>).outcome;
		if (!outcome || typeof outcome !== "object") {
			summary.skipped += 1;
			continue;
		}
		const outcomeRecord = outcome as Record<string, unknown>;
		// 已经压过的不再处理，避免反复哈希同一段。
		if (outcomeRecord.compacted !== undefined) {
			summary.skipped += 1;
			continue;
		}
		const text = JSON.stringify(outcome);
		if (text.length < MIN_BYTES) {
			summary.skipped += 1;
			continue;
		}
		const digest = createHash("sha256").update(text).digest("hex");
		(state as Record<string, unknown>).outcome = {
			status: outcomeRecord.status,
			compacted: {
				sha256: digest,
				bytes: Buffer.byteLength(text, "utf8"),
				head: slice(text, HEAD_BYTES, false),
				tail: slice(text, TAIL_BYTES, true),
				note: "正文见同会话转录 pi_entries",
			},
		};
		const next = JSON.stringify(record);
		summary.bytesBefore += Buffer.byteLength(row.record, "utf8");
		summary.bytesAfter += Buffer.byteLength(next, "utf8");
		if (options.apply === false) {
			summary.compacted += 1;
			summary.bytesReclaimed += Buffer.byteLength(row.record, "utf8") - Buffer.byteLength(next, "utf8");
			continue;
		}
		await db.run("UPDATE pi_tasks SET record = ? WHERE id = ?", next, row.id);
		summary.compacted += 1;
		summary.bytesReclaimed += Buffer.byteLength(row.record, "utf8") - Buffer.byteLength(next, "utf8");
	}
	return summary;
}
