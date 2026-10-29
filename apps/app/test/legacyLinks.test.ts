import { describe, expect, it, vi } from "vitest";
import { pathOfLegacyHash, upgradeLegacyLocation } from "../src/legacyLinks";

describe("legacyLinks", () => {
	it.each([
		["#/", "/"],
		["#/s/abc", "/work/abc"],
		["#/work", "/work"],
		["#/work/a%20b", "/work/a%20b"],
		["#/console", "/work/console"],
		["#/market", "/work/market"],
		["#/c/1", "/c/1"],
		["#/contacts/2", "/contacts/2"],
		["#/cards", "/cards"],
		["#/friends/add", "/friends/add"],
		["#/u/123", "/u/123"],
		["#/connect?code=7", "/connect?code=7"],
	])("%s → %s", (hash, path) => {
		expect(pathOfLegacyHash(hash)).toBe(path);
	});

	it("leaves unknown or non-route hashes alone", () => {
		expect(pathOfLegacyHash("")).toBeUndefined();
		expect(pathOfLegacyHash("#top")).toBeUndefined();
		expect(pathOfLegacyHash("#/nope")).toBeUndefined();
	});

	it("rewrites the location under the mount path and keeps the query", () => {
		const replaceState = vi.fn();
		vi.stubGlobal("location", { hash: "#/s/abc", search: "?devtools=1" });
		vi.stubGlobal("history", { state: null, replaceState });
		upgradeLegacyLocation("/console/");
		expect(replaceState).toHaveBeenCalledWith(null, "", "/console/work/abc?devtools=1");
		vi.unstubAllGlobals();
	});
});
