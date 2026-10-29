import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyStateOverride, DevtoolsStateError, forcedQueryState, isForcedState } from "../src/devtools/stateOverride";
import {
	DEVTOOLS_STORAGE_KEY,
	groupInviteHash,
	mergeStateOverrides,
	NO_STATE_OVERRIDE,
	parseStateMode,
	presetBreakpoint,
	previewUrl,
	publicCardHash,
	ROUTE_JUMPS,
	readDevtoolsEnabled,
	STATE_MODES,
	storeDevtoolsEnabled,
	storedDevtoolsEnabled,
	stripDevtoolsParam,
	THEME_CHOICES,
	themeAttribute,
	VIEWPORT_PRESETS,
	viewportOf,
} from "../src/devtools/viewState";

beforeEach(() => {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("devtools switch", () => {
	it("is off by default", () => {
		expect(readDevtoolsEnabled({})).toBe(false);
		expect(readDevtoolsEnabled({ search: "", stored: null })).toBe(false);
		expect(readDevtoolsEnabled({ search: "?other=1", stored: "0" })).toBe(false);
	});

	it("reads the URL parameter first", () => {
		expect(readDevtoolsEnabled({ search: "?devtools=1" })).toBe(true);
		expect(readDevtoolsEnabled({ search: "?devtools=0", stored: "1" })).toBe(false);
		expect(readDevtoolsEnabled({ search: "?a=1&devtools=1&b=2" })).toBe(true);
	});

	it("falls back to localStorage when the URL value is unknown", () => {
		expect(readDevtoolsEnabled({ search: "?devtools=yes", stored: "1" })).toBe(true);
		expect(readDevtoolsEnabled({ search: "?devtools=", stored: "1" })).toBe(true);
		expect(readDevtoolsEnabled({ search: "?devtools=yes", stored: null })).toBe(false);
	});

	it("ignores a malformed query string instead of throwing", () => {
		expect(readDevtoolsEnabled({ search: "?devtools=1%", stored: null })).toBe(false);
	});

	it("stores and reads the local switch", () => {
		expect(storedDevtoolsEnabled()).toBe(null);
		storeDevtoolsEnabled(true);
		expect(localStorage.getItem(DEVTOOLS_STORAGE_KEY)).toBe("1");
		expect(storedDevtoolsEnabled()).toBe("1");
		storeDevtoolsEnabled(false);
		expect(storedDevtoolsEnabled()).toBe("0");
	});

	it("treats an unavailable localStorage as off instead of throwing", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
		});
		expect(storedDevtoolsEnabled()).toBe(null);
		expect(() => storeDevtoolsEnabled(true)).not.toThrow();
	});
});

describe("cleanup and preview URLs", () => {
	it("removes devtools from the path query and keeps the rest", () => {
		expect(stripDevtoolsParam("https://host/console/?devtools=1&x=2#/work")).toBe("/console/?x=2#/work");
		expect(stripDevtoolsParam("https://host/?devtools=1#/s/abc")).toBe("/#/s/abc");
	});

	it("also removes devtools from a hash query", () => {
		expect(stripDevtoolsParam("https://host/console/?devtools=1#/connect?devtools=1&code=7")).toBe(
			"/console/#/connect?code=7",
		);
	});

	it("turns devtools off in the preview URL without losing the route", () => {
		expect(previewUrl("https://host/console/?devtools=1&x=2#/work")).toBe("https://host/console/?devtools=0&x=2#/work");
		expect(previewUrl("http://localhost:5174/#/s/abc")).toBe("http://localhost:5174/?devtools=0#/s/abc");
	});
});

describe("breakpoint presets", () => {
	it("maps each preset through the shell's breakpoint function", () => {
		expect(VIEWPORT_PRESETS.map((preset) => presetBreakpoint(preset.id))).toEqual(["phone", "tablet", "desktop"]);
	});

	it("keeps the design sizes", () => {
		expect(VIEWPORT_PRESETS.map((preset) => [preset.width, preset.height])).toEqual([
			[390, 844],
			[820, 1180],
			[1280, 800],
		]);
	});

	it("rejects an unknown preset instead of guessing", () => {
		expect(() => viewportOf("watch" as never)).toThrow(/未知断点预设/);
	});
});

describe("theme", () => {
	it("lists system first and maps choices to the html attribute", () => {
		expect(THEME_CHOICES.map((choice) => choice.id)).toEqual(["system", "light", "dark"]);
		expect(themeAttribute("system")).toBe(null);
		expect(themeAttribute("light")).toBe("light");
		expect(themeAttribute("dark")).toBe("dark");
	});
});

describe("route jumps", () => {
	it("covers the fixed pages from the shell parser", () => {
		expect(Object.fromEntries(ROUTE_JUMPS.map((jump) => [jump.key, jump.hash]))).toEqual({
			chats: "#/",
			contacts: "#/contacts",
			work: "#/work",
			me: "#/me",
			connect: "#/connect",
			get: "#/get",
		});
	});

	it("builds public card and group invite hashes and rejects empty input", () => {
		expect(publicCardHash("ABC123")).toBe("#/u/ABC123");
		expect(publicCardHash("  ")).toBeUndefined();
		expect(groupInviteHash("tok en")).toBe("#/g/tok%20en");
		expect(groupInviteHash("")).toBeUndefined();
	});
});

describe("state override", () => {
	it("accepts only the four known modes", () => {
		expect(STATE_MODES.map((mode) => mode.id)).toEqual(["none", "loading", "empty", "error"]);
		expect(parseStateMode("empty")).toBe("empty");
		expect(parseStateMode("bogus")).toBeUndefined();
		expect(parseStateMode(null)).toBeUndefined();
	});

	it("merges patches with the last valid mode winning", () => {
		expect(mergeStateOverrides(undefined)).toEqual({ mode: "none" });
		expect(mergeStateOverrides(NO_STATE_OVERRIDE, { mode: "error" })).toEqual({ mode: "error" });
		expect(mergeStateOverrides({ mode: "loading" }, undefined, { mode: "empty" })).toEqual({ mode: "empty" });
		expect(mergeStateOverrides({ mode: "loading" }, { mode: "bogus" as never })).toEqual({ mode: "loading" });
	});

	it("patches each mode without inventing business data", () => {
		const error = forcedQueryState("error", { data: [{ id: 1 }] });
		expect(error).toMatchObject({ status: "error", fetchStatus: "idle" });
		expect(error?.error).toBeInstanceOf(DevtoolsStateError);
		expect(forcedQueryState("loading", { data: [{ id: 1 }] })).toEqual({
			status: "pending",
			fetchStatus: "fetching",
			data: undefined,
			error: null,
		});
		expect(forcedQueryState("empty", { data: [{ id: 1 }] })).toEqual({
			status: "success",
			fetchStatus: "idle",
			data: [],
			error: null,
		});
		expect(forcedQueryState("none", { data: [] })).toBeUndefined();
	});

	it("skips the empty override for queries that do not hold an array", () => {
		expect(forcedQueryState("empty", { data: { sessions: [] } })).toBeUndefined();
		expect(forcedQueryState("empty", { data: undefined })).toBeUndefined();
	});

	it("recognises a query that already shows the forced state", () => {
		expect(isForcedState("loading", { status: "pending", fetchStatus: "fetching", data: undefined, error: null })).toBe(
			true,
		);
		expect(isForcedState("loading", { status: "pending", fetchStatus: "idle", data: undefined, error: null })).toBe(
			false,
		);
		expect(isForcedState("loading", { status: "success", data: [], error: null })).toBe(false);
		expect(isForcedState("error", { status: "error", data: undefined, error: new DevtoolsStateError() })).toBe(true);
		expect(isForcedState("error", { status: "error", data: undefined, error: new Error("网关失败") })).toBe(false);
		expect(isForcedState("empty", { status: "success", data: [], error: null })).toBe(true);
		expect(isForcedState("empty", { status: "success", data: [{ id: 1 }], error: null })).toBe(false);
		expect(isForcedState("none", { status: "error", data: undefined, error: null })).toBe(true);
	});

	it("overrides real cached queries and restores them afterwards", () => {
		const client = new QueryClient();
		const data = [{ id: "s1" }, { id: "s2" }];
		client.setQueryData(["sessions"], data);
		client.setQueryData(["facts"], { version: "1" });

		const errorHandle = applyStateOverride(client, "error");
		expect(client.getQueryState(["sessions"])?.status).toBe("error");
		expect(client.getQueryState(["facts"])?.error).toBeInstanceOf(DevtoolsStateError);
		expect(errorHandle.count()).toBe(2);
		errorHandle.stop();
		expect(client.getQueryState(["sessions"])?.status).toBe("success");
		expect(client.getQueryState(["sessions"])?.data).toEqual(data);
		expect(client.getQueryState(["facts"])?.error).toBe(null);

		const emptyHandle = applyStateOverride(client, "empty");
		expect(client.getQueryState(["sessions"])?.data).toEqual([]);
		// 非数组的查询不被替换，避免编造对象结构。
		expect(client.getQueryState(["facts"])?.data).toEqual({ version: "1" });
		expect(emptyHandle.count()).toBe(1);
		emptyHandle.stop();
		expect(client.getQueryState(["sessions"])?.data).toEqual(data);

		const loadingHandle = applyStateOverride(client, "loading");
		expect(client.getQueryState(["sessions"])?.status).toBe("pending");
		expect(client.getQueryState(["sessions"])?.data).toBeUndefined();
		loadingHandle.stop();
		expect(client.getQueryState(["sessions"])?.data).toEqual(data);
	});

	it("covers queries added while the override is active", () => {
		const client = new QueryClient();
		const handle = applyStateOverride(client, "empty");
		client.setQueryData(["work"], [{ id: "t1" }]);
		expect(client.getQueryState(["work"])?.data).toEqual([]);
		handle.stop();
		expect(client.getQueryState(["work"])?.data).toEqual([{ id: "t1" }]);
	});

	it("does nothing for the none mode", () => {
		const client = new QueryClient();
		client.setQueryData(["sessions"], [{ id: "s1" }]);
		const handle = applyStateOverride(client, "none");
		expect(handle.count()).toBe(0);
		handle.stop();
		expect(client.getQueryState(["sessions"])?.data).toEqual([{ id: "s1" }]);
	});
});
