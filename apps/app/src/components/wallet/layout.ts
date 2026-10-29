export interface Rect {
	top: number;
	left: number;
	width: number;
	height: number;
}
/** 一张卡在视口里的位置。x/y 是左上角。 */
export interface Slot {
	x: number;
	y: number;
	w: number;
	h: number;
	o: number;
	z: number;
}
export type WalletMode = "collapsed" | "fan" | "focus";

const RATIO = 4.3 / 3;
export const cardHeight = (w: number) => w * RATIO;
const PEEK = 9;
const STRIP = 56;
const HEAD = 60;

/**
 * 卡包三种姿态的位置表。n = 卡数。
 * collapsed：叠放，最上面一张露上半部分，下面露几条边，贴着 anchor。
 * fan：竖向展开，默认卡完整（带二维码），后面的卡只露顶部。
 * focus：第 k 张放大到全屏，其余下沉。
 */
export function walletSlots(mode: WalletMode, n: number, vw: number, vh: number, anchor: Rect, focus = 0): Slot[] {
	const out: Slot[] = [];
	if (mode === "collapsed") {
		const m = Math.min(3, n - 1);
		const w0 = Math.min(anchor.width - 32, 420);
		const h0 = Math.max(anchor.height - 8 - PEEK * m, 40);
		for (let k = 0; k < n; k++) {
			const j = Math.min(k, m, n - 1);
			const w = w0 - 18 * j;
			const front = j === 0;
			out.push({
				x: anchor.left + (anchor.width - w) / 2,
				y: anchor.top + (front ? 0 : 30),
				w,
				h: front ? h0 : h0 - 30 + PEEK * j,
				o: k <= m ? 1 : 0,
				z: n + 1 - k,
			});
		}
		return out;
	}
	if (mode === "focus") {
		const w = Math.min(vw - 32, 440, (vh - HEAD - 100) / RATIO);
		const h = cardHeight(w);
		for (let k = 0; k < n; k++) {
			const on = k === focus;
			out.push({
				x: (vw - w) / 2,
				y: on ? HEAD + Math.max(0, (vh - HEAD - 100 - h) / 2) : vh + 24,
				w,
				h,
				o: on ? 1 : 0,
				z: on ? n + 2 : k,
			});
		}
		return out;
	}
	const strip = n > 5 ? 40 : STRIP;
	const w = Math.max(180, Math.min(vw - 32, 360, (vh - HEAD - 24 - 8 - (n - 1) * strip) / RATIO));
	const h = cardHeight(w);
	let y = HEAD;
	for (let k = 0; k < n; k++) {
		out.push({ x: (vw - w) / 2, y, w, h, o: 1, z: k });
		y += k === 0 ? h + 8 : strip;
	}
	return out;
}
