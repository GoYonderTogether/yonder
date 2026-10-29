/** 右栏卡片栈与悬浮窗的布局计算：纯函数，不读存储、不碰 React；持久化仍在 lib/layout.ts。 */

/** 悬浮窗把手在主区域内至少要留出的宽高（像素），保证拖到边缘后仍能抓回来。 */
export const FLOAT_GRIP = { x: 56, y: 40 } as const;

/** 把 id 移到 to（越界夹到首尾）；id 不存在时按原顺序返回副本。 */
export function moveTo(ids: readonly string[], id: string, to: number): string[] {
	const from = ids.indexOf(id);
	if (from < 0) return [...ids];
	const target = Math.max(0, Math.min(ids.length - 1, to));
	const next = [...ids];
	const [card] = next.splice(from, 1);
	if (card !== undefined) next.splice(target, 0, card);
	return next;
}

/** 拖拽落点：active 落到 over 的位置；任一 id 缺失或相同则顺序不变。 */
export function reorderCards(ids: readonly string[], activeId: string, overId: string): string[] {
	const from = ids.indexOf(activeId);
	const to = ids.indexOf(overId);
	if (from < 0 || to < 0 || from === to) return [...ids];
	return moveTo(ids, activeId, to);
}

/** 键盘换位：dir=-1 上移、1 下移；已在首/尾或 id 不存在时不变。 */
export function moveCard(ids: readonly string[], id: string, dir: -1 | 1): string[] {
	const from = ids.indexOf(id);
	if (from < 0) return [...ids];
	return moveTo(ids, id, from + dir);
}

/** 悬浮窗坐标夹进主区域：左/上不越过 0，右/下至少留下把手；没有主区域尺寸时只夹下界。 */
export function clampFloatPosition(
	x: number,
	y: number,
	box?: { width: number; height: number },
): { x: number; y: number } {
	const maxX = box ? box.width - FLOAT_GRIP.x : Number.POSITIVE_INFINITY;
	const maxY = box ? box.height - FLOAT_GRIP.y : Number.POSITIVE_INFINITY;
	return { x: Math.max(0, Math.min(x, maxX)), y: Math.max(0, Math.min(y, maxY)) };
}

/** 顺序是否一致：一致就不写回存储，避免无意义的重渲染与存档。 */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i]);
}
