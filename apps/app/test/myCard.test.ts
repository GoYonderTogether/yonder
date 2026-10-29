import { describe, expect, it } from "vitest";
import type { Card } from "../src/api/types";
import {
	botCards,
	botDraftInput,
	canSaveCard,
	draftInput,
	formFromCard,
	pendingBotCards,
	pickMyCard,
	wantCardLogin,
} from "../src/lib/myCard";

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

describe("bot cards", () => {
	const list = [
		card({ id: "me-default", kind: "default" }),
		card({ id: "b1", ownerId: "bot", kind: "agent", updatedAt: 1 }),
		card({ id: "b2", ownerId: "bot", kind: "agent", status: "published", updatedAt: 2 }),
		card({ id: "recv", ownerId: "other", mine: false }),
	];
	it("lists only cards owned by my bots, newest first", () => {
		expect(botCards(list, "me").map((c) => c.id)).toEqual(["b2", "b1"]);
		expect(botCards(undefined, "me")).toEqual([]);
	});
	it("pending are the unpublished ones", () => {
		expect(pendingBotCards(botCards(list, "me")).map((c) => c.id)).toEqual(["b1"]);
	});
	it("keeps the bot's display and face when saving", () => {
		const c = card({ display: { kind: "svg", source: "<svg/>" }, face: { theme: "ink" } });
		expect(botDraftInput(c, { title: " 店 ", tagline: " 简 ", markdown: " 介绍 " })).toEqual({
			title: "店",
			tagline: "简",
			markdown: "介绍",
			display: c.display,
			face: c.face,
		});
		expect(botDraftInput(card({}), { title: "a", tagline: "", markdown: "" })).not.toHaveProperty("display");
	});
});
