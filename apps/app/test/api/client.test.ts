import { describe, expect, it } from "vitest";
import { qk } from "../../src/work/api";

describe("query keys", () => {
	it("scopes keys to the local or selected node", () => {
		expect(qk.sessions()).toEqual(["local", "sessions"]);
		expect(qk.sessions("remote")).toEqual(["remote", "sessions"]);
		expect(qk.session("s1")).toEqual(["local", "session", "s1"]);
		expect(qk.views("chat", "s1")).toEqual(["local", "views", "chat", "s1"]);
		expect(qk.capabilities("remote")).toEqual(["remote", "capabilities"]);
	});
});
