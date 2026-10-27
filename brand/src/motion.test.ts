import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";

const source = await readFile(new URL("./yonder-mark.js", import.meta.url), "utf8");
function character(scale: number, state: string) {
	let frame: (ms: number) => void;
	let frames = 0;
	let now = 0;
	const svg = { innerHTML: "", setAttribute() {}, addEventListener() {}, removeEventListener() {} };
	const code = source.replace("MOTION_TIME_SCALE = 3", `MOTION_TIME_SCALE = ${scale}`).replace(/^export /gm, "");
	const context = {
		Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
		performance: { now: () => now },
		matchMedia: () => ({ matches: false }),
		requestAnimationFrame: (callback: typeof frame) => {
			frame = callback;
			frames++;
			return frames;
		},
		cancelAnimationFrame() {},
		svg,
	};
	const api = runInNewContext(`${code}\ncreateCharacter(svg, {state: '${state}', pointer: false})`, context);
	return {
		tick(ms: number) {
			now = ms;
			frame(ms);
			return svg.innerHTML;
		},
		setState: api.setState,
		get frames() {
			return frames;
		},
	};
}

test("brand timeline is one third speed at every normal 60 Hz display frame, including state changes and looping", () => {
	for (const state of ["idle", "work", "done", "tour"]) {
		const slow = character(3, state),
			reference = character(1, state);
		// A complete tour is 31.7 original seconds / 95.1 wall seconds.
		const count = state === "tour" ? 6000 : 720;
		for (let i = 0; i <= count; i++) {
			const wall = (i * 1000) / 60;
			const actual = slow.tick(wall);
			const originalTime = reference.tick(wall / 3);
			// SVG rounds paths to .01 px. Compare numeric geometry, not float serialization.
			const numbers = /-?\d+(?:\.\d+)?/g;
			if (actual.replace(numbers, "#") !== originalTime.replace(numbers, "#"))
				throw new Error(`SVG topology changed: ${state}, frame ${i}`);
			const a = actual.match(numbers)!.map(Number),
				b = originalTime.match(numbers)!.map(Number);
			const error = Math.max(...a.map((value, index) => Math.abs(value - b[index]!)));
			if (error > 0.011) throw new Error(`Geometry changed ${error}px: ${state}, frame ${i}`);
			if (i === 300 && state === "work") {
				slow.setState("done");
				reference.setState("done");
			}
		}
		expect(slow.frames).toBe(count + 2); // initial request plus one per frame; no dropped/throttled frames
	}
}, 20000);

test("source consumers share the same timeline and static native brand remains static", async () => {
	expect(source).toContain("milliseconds / MOTION_TIME_SCALE / 1000");
	expect(source).not.toContain("setTimeout(");
	const build = await readFile(new URL("../../plugins/ui-companion/build.mjs", import.meta.url), "utf8");
	expect(build).toContain("brand/src/yonder-mark.js");
	const native = await readFile(new URL("../../packages/macos/Companion.swift", import.meta.url), "utf8");
	expect(native).toContain('forResource: "dock-mark"');
});
