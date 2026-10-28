import { describe, expect, it } from "vitest";
import { PAGES } from "../src/shell/registry";
import { PAGE_NAMES, parse } from "../src/shell/routes";

describe("page registry", () => {
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
