import { join } from "node:path";

/**
 * 状态快照：状态栏与 `yonder service info` 的唯一读模型。
 *
 * 为什么单独定义：状态栏需要的是"现在怎么样"，不是"服务里有什么"。
 * 把这份结构钉在这里，读取方不用理解内核结构，内核也不用迁就菜单栏。
 */

export interface StatusSnapshot {
	schemaVersion: 1;
	/** 内容变化才递增；读取方可以用它跳过无变化的重绘。 */
	revision: number;
	observedAt: number;
	ready: boolean;
	version: string;
	/** 处于活动状态的运行数，沿用 service.info 的既有语义。 */
	active: number;
	/**
	 * 逐 Agent 活动。刻意保持不透明：菜单栏只读 state/name/tasks，
	 * 内核可以自由调整内部结构而不牵动这个契约。
	 */
	agents: readonly unknown[];
}

export function statusPath(home: string): string {
	return join(home, ".yonder", "status.json");
}

/** 只比较会影响读取方呈现的部分，避免 revision 因时间戳抖动而空转。 */
export function sameSnapshot(a: StatusSnapshot | undefined, b: StatusSnapshot): boolean {
	if (!a) return false;
	return (
		a.ready === b.ready &&
		a.version === b.version &&
		a.active === b.active &&
		JSON.stringify(a.agents) === JSON.stringify(b.agents)
	);
}
