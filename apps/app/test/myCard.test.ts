import { describe, expect, it } from "vitest";
import type { Card } from "../src/api/types";
import { canSaveCard, draftInput, formFromCard, pickMyCard, wantCardLogin } from "../src/lib/myCard";

const card = (o: Partial<Card>): Card => ({
	id: "c",
	kind: "persona",
	ownerId: "me",
	respondentId: "me",
	title: "t",
	summary: null,
	mine: true,
	markdown: "",
	status: "draft",
	rev: 0,
	updatedAt: 0,
	...o,
});

describe("myCard", () => {
	it("prefers the default card and ignores others' and agents' cards", () => {
		const cards = [
			card({ id: "a", ownerId: "bot" }),
			card({ id: "b", mine: false }),
			card({ id: "p" }),
			card({ id: "d", kind: "default" }),
		];
		expect(pickMyCard(cards, "me")?.id).toBe("d");
		expect(pickMyCard(cards.slice(0, 3), "me")?.id).toBe("p");
		expect(pickMyCard(undefined, "me")).toBeUndefined();
	});
	it("builds the draft from the three fields", () => {
		const form = { name: " 小明 ", tagline: " 做设计 ", greeting: " 你好 " };
		expect(draftInput(form)).toEqual({ title: "小明", tagline: "做设计", markdown: "你好" });
		expect(formFromCard(card({ tagline: "x", markdown: "y" }), "n")).toEqual({
			name: "n",
			tagline: "x",
			greeting: "y",
		});
	});
	it("requires a name of at most 40 characters", () => {
		expect(canSaveCard({ name: " ", tagline: "", greeting: "" })).toBe(false);
		expect(canSaveCard({ name: "a".repeat(41), tagline: "", greeting: "" })).toBe(false);
		expect(canSaveCard({ name: "a", tagline: "", greeting: "" })).toBe(true);
	});
	it("login link carries next and the share token only when present", () => {
		expect(wantCardLogin()).toBe("/login?next=%2Fme%3Fcard%3Dnew");
		expect(wantCardLogin("tok")).toBe("/login?next=%2Fme%3Fcard%3Dnew&share=tok");
	});
});
