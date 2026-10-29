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

	it("把云端现行的 ?share=…#/u/<码> 压成挂载路径下的路径形态并保留 share", () => {
		const replaceState = vi.fn();
		vi.stubGlobal("location", { hash: "#/u/abc123", search: "?share=tok" });
		vi.stubGlobal("history", { state: null, replaceState });
		upgradeLegacyLocation("/console/");
		expect(replaceState).toHaveBeenCalledWith(null, "", "/console/u/abc123?share=tok");
		vi.unstubAllGlobals();
	});
});
