/**
 * 一轮保留任务的结果结构。
 *
 * 这份结构就是审计面：调用方只看它就能回答"删了什么、跳过了什么、为什么"。
 * 语义事实（事件日志、会话转录、任务笔记）不在这里出现——按
 * proposals/runtime-efficiency/checklist.md 第 0 节，它们永不删除。
 */
export interface SweepResult {
	/** 本轮开始时刻（毫秒）。 */
	startedAt: number;
	durationMs: number;
	/** 被归档的活跃日志路径。 */
	logsRotated: string[];
	/** 被删除的归档日志路径。 */
	logsRemoved: string[];
	backgroundDirsRemoved: number;
	backgroundBytesRemoved: number;
	/** 派生物回收的条数，由调用方回填。 */
	derivedCompacted: number;
	/** 真正从磁盘释放的字节数（归档清理 + 过期目录）。 */
	bytesReclaimed: number;
	/** 单个对象失败或超出预算的记录；一轮不因个别失败中止。 */
	skipped: Array<{ what: string; reason: string }>;
}

export function emptyResult(startedAt: number): SweepResult {
	return {
		startedAt,
		durationMs: 0,
		logsRotated: [],
		logsRemoved: [],
		backgroundDirsRemoved: 0,
		backgroundBytesRemoved: 0,
		derivedCompacted: 0,
		bytesReclaimed: 0,
		skipped: [],
	};
}

/**
 * 单行摘要，供每轮记一条 info 用。
 * 逐文件记录会把日志本身又变成增长源，这里只给聚合数。
 */
export function summarizeSweep(result: SweepResult): string {
	const parts = [
		`轮转 ${result.logsRotated.length}`,
		`删归档 ${result.logsRemoved.length}`,
		`合并后台目录 ${result.backgroundDirsRemoved}`,
		`回收派生物 ${result.derivedCompacted}`,
		`释放 ${formatBytes(result.bytesReclaimed)}`,
	];
	if (result.skipped.length > 0) parts.push(`跳过 ${result.skipped.length}`);
	return `保留任务 ${result.durationMs}ms：${parts.join("，")}`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
