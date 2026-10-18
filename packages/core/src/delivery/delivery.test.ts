import { expect, test } from "vitest";
import { ReplyText } from "./index.js";

test("NO_REPLY fragments stay private, ordinary progress is released without losing its prefix", () => {
	const marker = new ReplyText();
	expect(marker.push("  NO_")).toBe("");
	expect(marker.push("REPLY")).toBe("");
	expect(marker.push("\n")).toBe("");
	const text = new ReplyText();
	expect(text.push("N")).toBe("");
	expect(text.push("ext step")).toBe("Next step");
	expect(text.push(" completed.")).toBe(" completed.");
	const explanation = new ReplyText();
	expect(explanation.push("NO_REPLY")).toBe("");
	expect(explanation.push(" means no delivery")).toBe("NO_REPLY means no delivery");
});
