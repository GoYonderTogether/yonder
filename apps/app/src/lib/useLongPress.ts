import { type PointerEvent, useCallback, useRef } from "react";

export interface MenuAnchor {
	x: number;
	y: number;
}
const HOLD_MS = 450;
const MOVE_PX = 8;
const coarse = () => matchMedia("(pointer: coarse)").matches;

/**
 * 触屏长按 450ms（移动超过 8px 取消）弹菜单并 navigator.vibrate(8)；
 * 桌面右键 / Shift+F10 / 菜单键走同一回调。长按已触发时吞掉随后的 click，防止误进入会话。
 * 思路来源：C3 调研记录的 AI-Being useLongPress，此处按本项目重写。
 */
export function useMenuTrigger(open: (at: MenuAnchor) => void) {
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const origin = useRef<MenuAnchor>({ x: 0, y: 0 });
	const fired = useRef(false);
	const cancel = useCallback(() => clearTimeout(timer.current), []);

	return {
		onPointerDown(e: PointerEvent) {
			if (e.pointerType === "mouse") return;
			fired.current = false;
			origin.current = { x: e.clientX, y: e.clientY };
			cancel();
			timer.current = setTimeout(() => {
				fired.current = true;
				navigator.vibrate?.(8);
				open(origin.current);
			}, HOLD_MS);
		},
		onPointerMove(e: PointerEvent) {
			if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > MOVE_PX) cancel();
		},
		onPointerUp: cancel,
		onPointerCancel: cancel,
		onPointerLeave: cancel,
		onClickCapture(e: React.MouseEvent) {
			if (fired.current) {
				fired.current = false;
				e.preventDefault();
				e.stopPropagation();
			}
		},
		onContextMenu(e: React.MouseEvent) {
			e.preventDefault();
			if (coarse()) return; // 触屏的系统菜单由长按计时器接管
			open({ x: e.clientX, y: e.clientY });
		},
		onKeyDown(e: React.KeyboardEvent) {
			if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
				e.preventDefault();
				const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
				open({ x: r.left + 24, y: r.top + r.height / 2 });
			}
		},
	};
}
