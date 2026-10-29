import { type PointerEvent, useCallback, useRef } from "react";

export interface MenuAnchor {
	x: number;
	y: number;
}

/** 触屏长按 450ms，移动超过 8px 取消，触发时震动 8ms。 */
export const HOLD_MS = 450;
export const MOVE_PX = 8;
export const HAPTIC_MS = 8;

export interface HoldPolicy {
	/** 触发长按的计时（ms） */
	delay: number;
	/** 触发时的震动时长（ms） */
	haptic: number;
}

/** 鼠标不长按（右键走 onContextMenu）；手指与触控笔都长按。 */
export function holdPolicy(pointerType: string): HoldPolicy | null {
	return pointerType === "mouse" ? null : { delay: HOLD_MS, haptic: HAPTIC_MS };
}

/** 指针离开按下点超过阈值即取消长按。 */
export function holdCancelled(origin: MenuAnchor, at: MenuAnchor): boolean {
	return Math.hypot(at.x - origin.x, at.y - origin.y) > MOVE_PX;
}

/** Shift+F10 / 菜单键：锚点取触发元素左侧 24px、垂直居中。 */
export function keyboardAnchor(rect: { left: number; top: number; height: number }): MenuAnchor {
	return { x: rect.left + 24, y: rect.top + rect.height / 2 };
}

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
			const policy = holdPolicy(e.pointerType);
			if (!policy) return;
			fired.current = false;
			origin.current = { x: e.clientX, y: e.clientY };
			cancel();
			timer.current = setTimeout(() => {
				fired.current = true;
				navigator.vibrate?.(policy.haptic);
				open(origin.current);
			}, policy.delay);
		},
		onPointerMove(e: PointerEvent) {
			if (holdCancelled(origin.current, { x: e.clientX, y: e.clientY })) cancel();
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
				open(keyboardAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()));
			}
		},
	};
}
