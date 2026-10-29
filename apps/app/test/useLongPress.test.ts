import { describe, expect, it } from "vitest";
import { HAPTIC_MS, HOLD_MS, holdCancelled, holdPolicy, keyboardAnchor, MOVE_PX } from "../src/work/lib/useLongPress";

describe("hold policy", () => {
	it("arms long press for touch and pen, not for mouse", () => {
		expect(holdPolicy("touch")).toEqual({ delay: HOLD_MS, haptic: HAPTIC_MS });
		expect(holdPolicy("pen")).toEqual({ delay: HOLD_MS, haptic: HAPTIC_MS });
		expect(holdPolicy("mouse")).toBeNull();
	});

	it("keeps the documented 450ms hold and 8ms vibration", () => {
		expect(HOLD_MS).toBe(450);
		expect(HAPTIC_MS).toBe(8);
	});
});

describe("hold cancellation", () => {
	const origin = { x: 100, y: 100 };

	it("stays armed within the movement threshold", () => {
		expect(holdCancelled(origin, { x: 100 + MOVE_PX, y: 100 })).toBe(false);
		expect(holdCancelled(origin, { x: 103, y: 103 })).toBe(false);
	});

	it("cancels once the pointer moves past the threshold", () => {
		expect(holdCancelled(origin, { x: 100 + MOVE_PX + 1, y: 100 })).toBe(true);
		expect(holdCancelled(origin, { x: 100, y: 100 - MOVE_PX - 1 })).toBe(true);
	});
});

describe("keyboard anchor", () => {
	it("sits 24px inside the trigger and vertically centred", () => {
		expect(keyboardAnchor({ left: 40, top: 200, height: 48 })).toEqual({ x: 64, y: 224 });
	});
});
