import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PAGES } from "../src/shell/registry";
import { PAGE_NAMES, parse } from "../src/shell/routes";

vi.mock("../src/features/social/Profile", () => ({
	Profile: ({ accountId }: { accountId?: string }) => createElement("span", null, accountId ?? "me"),
}));

describe("page registry", () => {
	it("loads the profile for the me route", () => {
		expect(PAGES.me.load).toBeTypeOf("function");
	});
	it("covers every route page", () => {
		expect(Object.keys(PAGES).sort()).toEqual([...PAGE_NAMES].sort());
	});
	it("marks exactly the public pages", () => {
		const pub = PAGE_NAMES.filter((p) => PAGES[p].public).sort();
		expect(pub).toEqual(["connect", "g", "get", "p", "u"]);
	});
	it("registers market at #/market without a new tab", () => {
		expect(parse("#/market")).toEqual({ tab: "chats", page: "market" });
		expect(PAGES.market.public).toBeFalsy();
		expect(PAGES.market.load).toBeTypeOf("function");
	});
});

it("passes the public route id only to the public profile", async () => {
	const me = await PAGES.me.load?.();
	const publicProfile = await PAGES.p.load?.();
	if (!me || !publicProfile) throw new Error("Profile routes are not registered");
	expect(renderToStaticMarkup(createElement(me.default, { id: "ignored" }))).toBe("<span>me</span>");
	expect(renderToStaticMarkup(createElement(publicProfile.default, { id: "account-1" }))).toBe(
		"<span>account-1</span>",
	);
});
