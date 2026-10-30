import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { DragScroll } from "../src/work/ui/DragScroll";

it("鼠标拖动滚动并阻止拖动点击，普通点击、键盘和触摸保留", async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = document.createElement("div");
	const root = createRoot(container as never);
	await act(() =>
		root.render(
			<DragScroll>
				<a href="/work/test">Bot</a>
			</DragScroll>,
		),
	);
	const nav = container.querySelector("nav") as unknown as HTMLElement;
	const key = Object.keys(nav).find((name) => name.startsWith("__reactProps$")) ?? "";
	const props = (nav as unknown as Record<string, Record<string, (event: unknown) => void>>)[key];
	const pointer = (x: number, type = "mouse") => ({
		pointerType: type,
		button: 0,
		clientX: x,
		pointerId: 1,
		currentTarget: nav,
		preventDefault: vi.fn(),
	});
	Object.assign(nav, { scrollLeft: 100, setPointerCapture: vi.fn() });
	props?.onPointerDown(pointer(100));
	props?.onPointerMove(pointer(70));
	expect(nav.scrollLeft).toBe(130);
	props?.onPointerUp({});
	const click = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
	props?.onClickCapture(click);
	expect(click.preventDefault).toHaveBeenCalledOnce();
	props?.onPointerDown(pointer(100));
	props?.onPointerUp({});
	const normal = { detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() };
	props?.onClickCapture(normal);
	expect(normal.preventDefault).not.toHaveBeenCalled();
	props?.onPointerDown(pointer(100, "touch"));
	props?.onPointerMove(pointer(70, "touch"));
	expect(nav.scrollLeft).toBe(130);
	props?.onPointerDown(pointer(100));
	props?.onPointerMove(pointer(70));
	props?.onPointerUp({});
	const keyboard = { detail: 0, preventDefault: vi.fn(), stopPropagation: vi.fn() };
	props?.onClickCapture(keyboard);
	expect(keyboard.preventDefault).not.toHaveBeenCalled();
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});
