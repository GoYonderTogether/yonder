/**
 * 手机输入法：Safari 与 WKWebView 弹出键盘时只缩 visualViewport，不改布局视口，
 * 键盘会盖住输入条和贴底 / 居中的窗口。这里把可见高度写进 --app-height，让根布局、
 * 全屏面板（.dialog-sheet）与居中窗口（.dialog-center）跟着可见区收缩。
 * 键盘收起时不写变量，交回样式里的 100dvh。
 *
 * 双指放大同样会改变 visualViewport；只有缩放为 1 且键盘占位足够大时才认作键盘，
 * 避免把用户缩放误当成键盘而改写布局。
 */
export type VisibleArea = { height: number; offsetTop: number; scale?: number };
export type KeyboardLayout = { height: number; inset: number };

/** 低于这个高度的占位不当作键盘（地址栏收缩、滚动回弹都会带来几个像素的差）。 */
export const KEYBOARD_MIN_PX = 80;

/** 可见高度 = visualViewport 高度；键盘占位 = 布局视口底边与可见底边之差。 */
export function keyboardLayout(layoutHeight: number, visible?: VisibleArea | null): KeyboardLayout | undefined {
	if (!visible || !(visible.height > 0) || !(layoutHeight > 0)) return;
	if (visible.scale !== undefined && Math.abs(visible.scale - 1) > 0.01) return;
	const height = Math.min(layoutHeight, Math.round(visible.height));
	const inset = Math.max(0, Math.round(layoutHeight - visible.height - Math.max(0, visible.offsetTop)));
	if (inset < KEYBOARD_MIN_PX) return { height: layoutHeight, inset: 0 };
	return { height, inset };
}

type StyleTarget = { setProperty(name: string, value: string): void; removeProperty(name: string): void };

/** 键盘收起（占位为 0）时清掉变量，让样式里的 100dvh 与 100% 接管。 */
export function writeKeyboardLayout(style: StyleTarget, layout?: KeyboardLayout): void {
	if (layout && layout.inset > 0) {
		style.setProperty("--app-height", `${layout.height}px`);
		style.setProperty("--keyboard-inset", `${layout.inset}px`);
		return;
	}
	style.removeProperty("--app-height");
	style.removeProperty("--keyboard-inset");
}

/** 挂上监听并返回解绑函数；没有 visualViewport 的环境（测试、旧内核）不动任何样式。 */
export function watchKeyboard(scope: Window = window): () => void {
	const visual = scope.visualViewport;
	const root = scope.document?.documentElement;
	if (!visual || !root) return () => {};
	let frame = 0;
	const update = () => {
		frame = 0;
		writeKeyboardLayout(root.style, keyboardLayout(scope.innerHeight, visual));
	};
	// 键盘动画会连续触发 resize/scroll：一帧只写一次。
	const schedule = () => {
		if (frame) return;
		frame = scope.requestAnimationFrame
			? scope.requestAnimationFrame(update)
			: (setTimeout(update, 16) as unknown as number);
	};
	update();
	visual.addEventListener("resize", schedule);
	visual.addEventListener("scroll", schedule);
	scope.addEventListener("orientationchange", schedule);
	return () => {
		if (frame) {
			if (scope.cancelAnimationFrame) scope.cancelAnimationFrame(frame);
			else clearTimeout(frame);
			frame = 0;
		}
		visual.removeEventListener("resize", schedule);
		visual.removeEventListener("scroll", schedule);
		scope.removeEventListener("orientationchange", schedule);
		writeKeyboardLayout(root.style);
	};
}

/**
 * 锁定页面缩放：iOS Safari 从 10 起忽略 viewport 的 user-scalable/maximum-scale，
 * 只认手势事件，所以双指缩放由这里拦；触屏双击由样式里的 touch-action 拦。
 * 长按（-webkit-touch-callout）不拦：消息正文要能长按选中复制。
 */
export function lockZoom(scope: Window = window): () => void {
	const target = scope.document;
	if (!target) return () => {};
	const prevent = (event: Event) => event.preventDefault();
	const gestures = ["gesturestart", "gesturechange", "gestureend"];
	for (const name of gestures) target.addEventListener(name, prevent, { passive: false });
	return () => {
		for (const name of gestures) target.removeEventListener(name, prevent);
	};
}
