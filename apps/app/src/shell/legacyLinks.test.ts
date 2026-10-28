import { afterEach, describe, expect, it, vi } from "vitest";
import { upgradeLegacyLocation } from "./legacyLinks";

afterEach(() => vi.unstubAllGlobals());

describe("upgradeLegacyLocation", () => {
	it.each([
		["/u/123", "/u/123"],
		["/p/123", "/p/123"],
		["/g/token", "/g/token"],
		["/get", "/get"],
		["/connect", "/connect"],
		["/c/123", "/c/123"],
		["/contacts/123", "/contacts/123"],
		["/me", "/me"],
		["/friends/add", "/friends/add"],
		["/cards/123", "/cards/123"],
		["/login", "/me"],
		["/cards/123/edit", "/cards/123"],
	])("upgrades %s", (path, target) => {
		const replaceState = vi.fn();
		vi.stubGlobal("location", { pathname: `/console${path}`, search: "?ref=abc", hash: "" });
		vi.stubGlobal("history", { state: { existing: true }, replaceState });
		upgradeLegacyLocation();
		expect(replaceState).toHaveBeenCalledWith({ existing: true }, "", `/console/?ref=abc#${target}`);
	});

	it.each([
		["/console/", ""],
		["/unknown", ""],
		["/u/123", "#/me"],
		["/u/123/extra", ""],
	])("leaves %s with hash %s alone", (pathname, hash) => {
		const replaceState = vi.fn();
		vi.stubGlobal("location", { pathname, search: "", hash });
		vi.stubGlobal("history", { replaceState });
		upgradeLegacyLocation();
		expect(replaceState).not.toHaveBeenCalled();
	});

	it("upgrades root-hosted links", () => {
		const replaceState = vi.fn();
		vi.stubGlobal("location", { pathname: "/u/123", search: "?ref=abc", hash: "" });
		vi.stubGlobal("history", { state: null, replaceState });
		upgradeLegacyLocation();
		expect(replaceState).toHaveBeenCalledWith(null, "", "/?ref=abc#/u/123");
	});
});
