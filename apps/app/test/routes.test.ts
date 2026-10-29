import { describe, expect, it } from "vitest";
import { href, parse } from "../src/work/shell/routes";

describe("hash routes", () => {
	it("recognizes and round trips each route", () => {
		for (const hash of [
			"#/s/a",
			"#/c/a",
			"#/contacts",
			"#/contacts/a",
			"#/cards",
			"#/cards/a",
			"#/work",
			"#/work/a",
			"#/me",
			"#/u/a",
			"#/p/a",
			"#/g/a",
			"#/get",
			"#/friends/add",
			"#/connect",
			"#/market",
		]) {
			expect(href(parse(hash))).toBe(hash);
		}
		expect(parse("#/s/a%2Fb").session).toBe("a/b");
		expect(parse("#/s/%XX")).toEqual({ tab: "chats" });
	});
});
