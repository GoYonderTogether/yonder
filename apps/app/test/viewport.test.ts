import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { keyboardLayout, lockZoom, watchKeyboard, writeKeyboardLayout } from "../src/lib/viewport";

const style = () => {
	const values = new Map<string, string>();
	return {
		values,
		setProperty: (name: string, value: string) => void values.set(name, value),
		removeProperty: (name: string) => void values.delete(name),
	};
};

describe("mobile keyboard layout", () => {
	it("treats the visual viewport shrink as the keyboard and keeps the root at the visible height", () => {
		// 844 的布局视口，键盘弹出后可见区 500：可用高度 500，键盘占 344。
		expect(keyboardLayout(844, { height: 500, offsetTop: 0, scale: 1 })).toEqual({ height: 500, inset: 344 });
	});

	it("ignores pinching, scroll jitter and environments without a visual viewport", () => {
		expect(keyboardLayout(844, { height: 500, offsetTop: 0, scale: 2 })).toBeUndefined();
		expect(keyboardLayout(844, null)).toBeUndefined();
		expect(keyboardLayout(0, { height: 0, offsetTop: 0 })).toBeUndefined();
		// 地址栏收缩只差几十像素：不当作键盘，也不改写根高度。
		expect(keyboardLayout(844, { height: 800, offsetTop: 0, scale: 1 })).toEqual({ height: 844, inset: 0 });
	});

	it("clears the variables when the keyboard closes so 100dvh takes over", () => {
		const css = style();
		writeKeyboardLayout(css, { height: 500, inset: 344 });
		expect(css.values.get("--app-height")).toBe("500px");
		expect(css.values.get("--keyboard-inset")).toBe("344px");
		writeKeyboardLayout(css, { height: 844, inset: 0 });
		expect(css.values.size).toBe(0);
	});

	it("follows visualViewport resize and unbinds cleanly", () => {
		const listeners = new Map<string, () => void>();
		const css = style();
		const visual = {
			height: 844,
			offsetTop: 0,
			scale: 1,
			addEventListener: (name: string, fn: () => void) => void listeners.set(`visual:${name}`, fn),
			removeEventListener: (name: string) => void listeners.delete(`visual:${name}`),
		};
		const win = {
			innerHeight: 844,
			visualViewport: visual,
			document: { documentElement: { style: css } },
			requestAnimationFrame: (fn: () => void) => {
				fn();
				return 1;
			},
			cancelAnimationFrame: () => {},
			addEventListener: (name: string, fn: () => void) => void listeners.set(`window:${name}`, fn),
			removeEventListener: (name: string) => void listeners.delete(`window:${name}`),
		} as unknown as Window;
		const stop = watchKeyboard(win);
		expect(css.values.size).toBe(0);
		visual.height = 500;
		listeners.get("visual:resize")?.();
		expect(css.values.get("--keyboard-inset")).toBe("344px");
		stop();
		expect(css.values.size).toBe(0);
		expect(listeners.size).toBe(0);
	});

	it("blocks the pinch gestures iOS uses instead of the viewport meta", () => {
		const listeners = new Map<string, (event: Event) => void>();
		const win = {
			document: {
				addEventListener: (name: string, fn: (event: Event) => void) => void listeners.set(name, fn),
				removeEventListener: (name: string) => void listeners.delete(name),
			},
		} as unknown as Window;
		const stop = lockZoom(win);
		const event = { preventDefault: vi.fn() } as unknown as Event;
		for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
			listeners.get(name)?.(event);
		}
		expect(event.preventDefault).toHaveBeenCalledTimes(3);
		stop();
		expect(listeners.size).toBe(0);
	});
});

describe("page zoom is locked in the document", () => {
	it("never lets the page scale, including the form-filling stage", () => {
		const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
		expect(html).toMatch(/user-scalable=no/);
		expect(html).toMatch(/maximum-scale=1/);
		expect(html).toContain("viewport-fit=cover");
		expect(html).toContain("interactive-widget=resizes-content");
	});
});
