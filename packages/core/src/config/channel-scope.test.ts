import { allowsChannelInstance, assertChannelInstance, intersectChannelInstances } from "@yonder/sdk";
import { Check } from "typebox/value";
import { expect, test } from "vitest";
import { presetProfile, presetSession, resolveProfile } from "./index.js";
import { PresetSchema, ProfileSchema } from "./schema.js";

test("scope schema, defaults replacement, legacy compatibility and admin/bypass constraints", () => {
	for (const channelInstances of [undefined, [], ["a"], ["a", "b"]]) {
		const profile = channelInstances === undefined ? {} : { channelInstances };
		expect(Check(ProfileSchema, profile)).toBe(true);
		expect(Check(PresetSchema, { schema: 1, description: "Scope regression", ...profile })).toBe(true);
	}
	for (const channelInstances of [["A"], ["a", "a"], "a", [""]])
		expect(Check(ProfileSchema, { channelInstances })).toBe(false);
	expect(resolveProfile({}).channelInstances).toBeUndefined();
	expect(resolveProfile({}, { channelInstances: ["a"] }).channelInstances).toEqual(["a"]);
	const scope = resolveProfile({ level: "bypass", channelInstances: [] }, { channelInstances: ["a"] });
	expect(scope.capabilities).toContain("admin");
	expect(scope.channelInstances).toEqual([]);
	expect(allowsChannelInstance({}, "b")).toBe(true);
	expect(allowsChannelInstance(scope, "b")).toBe(false);
	expect(() => assertChannelInstance(scope, "b")).toThrow("not authorized");
	expect(resolveProfile({ channelInstances: ["b"] }, { channelInstances: ["a"] }).channelInstances).toEqual(["b"]);
});

test("preset scope intersection has an undefined identity and keeps captured ceilings on reload", () => {
	for (const [parent, preset, expected] of [
		[undefined, undefined, undefined],
		[undefined, ["a"], ["a"]],
		[["a"], undefined, ["a"]],
		[["a", "b"], ["b", "c"], ["b"]],
		[[], undefined, []],
		[undefined, [], []],
		[["a"], ["b"], []],
	] as Array<[string[] | undefined, string[] | undefined, string[] | undefined]>) {
		expect(intersectChannelInstances(parent, preset)).toEqual(expected);
		const opener = resolveProfile(parent === undefined ? {} : { channelInstances: parent });
		const selected = preset === undefined ? {} : { channelInstances: preset };
		const saved = presetSession(selected, "local", opener);
		expect(saved.channelInstances).toEqual(expected);
		expect(
			presetProfile({}, "local", saved.capabilities, saved.inherit, saved.channelInstances).channelInstances,
		).toEqual(expected);
	}
	expect(presetSession({ channelInstances: ["b"] }, "local").channelInstances).toEqual(["b"]);
});

test("current preset capability revocation is intersected with the saved ceiling for program owners", () => {
	expect(presetProfile({ capabilities: ["read"] }, "local", ["read", "message"]).capabilities).toEqual(["read"]);
	expect(presetProfile({ level: "bypass" }, "local", ["read"]).capabilities).toEqual(["read"]);
	expect(presetProfile({}, "local", ["read", "message"]).capabilities).toEqual(["read", "message"]);
});
