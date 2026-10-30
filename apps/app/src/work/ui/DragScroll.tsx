import { type ReactNode, useRef } from "react";

/** 鼠标拖动横向列表；触摸与触控板保留浏览器原生滚动。 */
export function DragScroll({ children }: { children: ReactNode }) {
	const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
	const suppressClick = useRef(false);
	return (
		<nav
			aria-label="Bot"
			data-testid="bot-strip"
			className="flex gap-3 overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
			onPointerDown={(event) => {
				if (event.pointerType !== "mouse" || event.button !== 0) return;
				suppressClick.current = false;
				drag.current = { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false };
			}}
			onPointerMove={(event) => {
				const start = drag.current;
				if (!start) return;
				const distance = event.clientX - start.x;
				if (!start.moved && Math.abs(distance) < 5) return;
				if (!start.moved) event.currentTarget.setPointerCapture(event.pointerId);
				start.moved = true;
				event.currentTarget.scrollLeft = start.scroll - distance;
				event.preventDefault();
			}}
			onPointerUp={() => {
				suppressClick.current = !!drag.current?.moved;
				drag.current = null;
			}}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onClickCapture={(event) => {
				if (!suppressClick.current || event.detail === 0) return;
				suppressClick.current = false;
				event.preventDefault();
				event.stopPropagation();
			}}
			onDragStart={(event) => event.preventDefault()}
		>
			{children}
		</nav>
	);
}
