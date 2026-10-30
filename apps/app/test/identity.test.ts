import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../src/work/api/types";
import { titleOf } from "../src/work/lib/identity";

const base: SessionInfo = {
	id: "9",
	agent: "main",
	profile: "owner",
	mode: "main",
	key: "main",
	version: "1",
	opened: "",
};

describe("titleOf", () => {
	it("uses the Bot display name from bots.list for main sessions", () => {
		expect(titleOf(base, new Map([["main", "贾维斯"]]))).toBe("贾维斯");
	});
	it("falls back to the agent id without a name", () => {
		expect(titleOf(base)).toBe("main");
		expect(titleOf(base, new Map())).toBe("main");
	});
	it("distinguishes persistent conversations of the same Bot", () => {
		expect(titleOf({ ...base, mode: "persistent", key: "conv:qq:group" }, new Map([["main", "贾维斯"]]))).toBe(
			"贾维斯 · conv:qq:group",
		);
	});
	it("shows a human label for untitled tasks", () => {
		expect(
			titleOf({ ...base, agent: null, mode: "task", id: "abcdef123", profile: "default" }, new Map([["main", "x"]])),
		).toBe("新任务");
	});
});
