import { describe, expect, it } from "vitest";
import { action, choiceItem, menuItems, stepIndex, toggleItem } from "../src/work/lib/actions";

const noop = () => {};

describe("action builders", () => {
	it("builds a plain item without optional fields", () => {
		expect(action("copy", "复制", noop)).toEqual({ key: "copy", label: "复制", onSelect: noop });
	});

	it("carries icon, checked and danger through", () => {
		const Icon = () => null;
		expect(action("pin", "置顶", noop, { icon: Icon, checked: true, danger: true })).toEqual({
			key: "pin",
			label: "置顶",
			onSelect: noop,
			icon: Icon,
			checked: true,
			danger: true,
		});
	});

	it("switches the toggle label with its state", () => {
		expect(toggleItem("pin", true, "取消置顶", "置顶", noop).label).toBe("取消置顶");
		expect(toggleItem("pin", false, "取消置顶", "置顶", noop).label).toBe("置顶");
	});

	it("marks only the selected choice", () => {
		expect(choiceItem("mute", "免打扰：静音", true, noop).checked).toBe(true);
		expect(choiceItem("all", "免打扰：关闭", false, noop).checked).toBe(false);
	});
});

describe("menuItems", () => {
	it("drops conditional entries and keeps order", () => {
		const items = menuItems([action("a", "甲", noop), false, null, undefined, action("b", "乙", noop)]);
		expect(items.map((i) => i.key)).toEqual(["a", "b"]);
	});

	it("returns a new array and leaves the input untouched", () => {
		const first = action("a", "甲", noop);
		const input = [first];
		expect(menuItems(input)).not.toBe(input);
		expect(input).toEqual([first]);
	});
});

describe("stepIndex", () => {
	it("wraps forward and backward", () => {
		expect(stepIndex(0, 3, 1)).toBe(1);
		expect(stepIndex(2, 3, 1)).toBe(0);
		expect(stepIndex(0, 3, -1)).toBe(2);
		expect(stepIndex(1, 3, -1)).toBe(0);
	});

	it("enters at the right end when focus is outside the menu", () => {
		expect(stepIndex(-1, 3, 1)).toBe(0);
		expect(stepIndex(-1, 3, -1)).toBe(2);
		expect(stepIndex(9, 3, 1)).toBe(0);
	});

	it("reports no target for an empty menu", () => {
		expect(stepIndex(0, 0, 1)).toBe(-1);
		expect(stepIndex(-1, 0, -1)).toBe(-1);
	});
});
