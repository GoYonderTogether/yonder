import { describe, expect, it } from "vitest";
import { clampFloatPosition, FLOAT_GRIP, moveCard, moveTo, reorderCards, sameOrder } from "../src/lib/railLayout";

const ids = ["a", "b", "c", "d"];

describe("reorderCards", () => {
	it.each([
		["a", "c", ["b", "c", "a", "d"]],
		["d", "a", ["d", "a", "b", "c"]],
		["b", "b", ["a", "b", "c", "d"]],
		["a", "missing", ["a", "b", "c", "d"]],
		["missing", "a", ["a", "b", "c", "d"]],
	] as const)("moves %s over %s", (active, over, want) => {
		expect(reorderCards(ids, active, over)).toEqual(want);
	});

	it("returns a copy, not the input array", () => {
		const next = reorderCards(ids, "a", "b");
		expect(next).not.toBe(ids);
		expect(ids).toEqual(["a", "b", "c", "d"]);
	});
});

describe("moveCard", () => {
	it.each([
		["b", -1, ["b", "a", "c", "d"]],
		["b", 1, ["a", "c", "b", "d"]],
		["a", -1, ["a", "b", "c", "d"]],
		["d", 1, ["a", "b", "c", "d"]],
		["missing", 1, ["a", "b", "c", "d"]],
	] as const)("moves %s by %i", (id, dir, want) => {
		expect(moveCard(ids, id, dir)).toEqual(want);
	});

	it("handles a single card and an empty stack", () => {
		expect(moveCard(["only"], "only", -1)).toEqual(["only"]);
		expect(moveCard([], "a", 1)).toEqual([]);
	});
});

describe("moveTo", () => {
	it("clamps out-of-range targets to the ends", () => {
		expect(moveTo(ids, "d", -5)).toEqual(["d", "a", "b", "c"]);
		expect(moveTo(ids, "a", 99)).toEqual(["b", "c", "d", "a"]);
	});
});

describe("clampFloatPosition", () => {
	const box = { width: 800, height: 600 };

	it("keeps an in-range position untouched", () => {
		expect(clampFloatPosition(120, 80, box)).toEqual({ x: 120, y: 80 });
	});

	it("never lets the card leave the top or left edge", () => {
		expect(clampFloatPosition(-40, -10, box)).toEqual({ x: 0, y: 0 });
	});

	it("keeps the grip reachable at the right and bottom edge", () => {
		expect(clampFloatPosition(5000, 5000, box)).toEqual({
			x: box.width - FLOAT_GRIP.x,
			y: box.height - FLOAT_GRIP.y,
		});
	});

	it("clamps a host smaller than the grip to the origin", () => {
		expect(clampFloatPosition(30, 30, { width: 10, height: 10 })).toEqual({ x: 0, y: 0 });
	});

	it("only clamps the lower bound when the host size is unknown", () => {
		expect(clampFloatPosition(-5, 1234)).toEqual({ x: 0, y: 1234 });
	});
});

describe("sameOrder", () => {
	it.each([
		[["a", "b"], ["a", "b"], true],
		[["a", "b"], ["b", "a"], false],
		[["a"], ["a", "b"], false],
		[[], [], true],
	] as const)("%j vs %j → %s", (a, b, want) => {
		expect(sameOrder(a, b)).toBe(want);
	});
});
