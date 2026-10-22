import { describe, expect, test } from "vitest";
import { containsBodyFragment } from "./body-leakage.js";

describe("long-message tool-argument leak scan", () => {
	test("catches fragments from different regions of varied body text, not only a repeated unit", () => {
		const sections = [
			"First region: 🪶 multilingual résumé; <xml> & escaped \\\"quotes\\\".",
			"Second region: 42/7 — punctuation!? newline follows, with mixed_CASE tokens.",
			"Third region: 日本語かなと漢字、中文内容，以及 العربية والكلمات.",
			"Fourth region: a deliberately distinctive tail marker zebra-9173-omega.",
		];
		const body = Array.from({ length: 180 }, (_, i) => `${sections[i % sections.length]} [section-${i}]\n`).join("");
		expect(body.length).toBeGreaterThan(14_000);
		for (const offset of [40, 1_700, 8_400, 12_500]) {
			const leakedFragment = Array.from(body).slice(offset, offset + 32).join("");
			expect(containsBodyFragment(JSON.stringify({ from: leakedFragment }), body)).toBe(true);
		}
		expect(containsBodyFragment(JSON.stringify({ eventId: "evt-123", handle: "opaque-handle" }), body)).toBe(false);
		// This deliberately does not claim that a one-character overlap proves leakage.
		expect(containsBodyFragment("x", body)).toBe(false);
	});
});
