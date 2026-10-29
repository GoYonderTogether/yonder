import type { Preset, SessionModels } from "@yonder/sdk";
import { Check } from "typebox/value";
import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { mergeCredentialSlots, parseAgentConfig, parsePresetConfig, presetSession } from "./index.js";
import { PresetSchema, ProfileSchema, SessionModelsSchema } from "./schema.js";
import { presetProfile, resolveProfile, testModel } from "./test-support.js";

test("accepts only documented fallback order values", () => {
	for (const order of [undefined, "accounts-first", "models-first"]) {
		expect(Check(SessionModelsSchema, { fallback: { models: [], ...(order && { order }) } })).toBe(true);
	}
	expect(Check(SessionModelsSchema, { fallback: { models: [], order: "legacy" } })).toBe(false);
});

const agentConfig = (defaults = {}, profile = {}) =>
	parseAgentConfig(
		JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "owner",
			defaults,
			profiles: { owner: profile },
			bindings: [],
		}),
	);

test("credential slot maps are accepted in defaults/profile/preset/session; invalid shapes are rejected", () => {
	for (const credentialSlots of [undefined, {}, { openai: "default" }, { openai: "work", anthropic: "personal" }]) {
		const models = credentialSlots === undefined ? {} : { credentialSlots };
		expect(Check(SessionModelsSchema, models)).toBe(true);
		expect(Check(ProfileSchema, models)).toBe(true);
		expect(Check(PresetSchema, { schema: 1, description: "Slot configuration check", ...models })).toBe(true);
		expect(agentConfig(models, models).defaults).toEqual(models);
		expect(
			parsePresetConfig(JSON.stringify({ schema: 1, description: "Slot configuration check", ...models }), "slots"),
		).toMatchObject(models);
	}
	for (const credentialSlots of [
		null,
		"work",
		["work"],
		{ openai: "" },
		{ "": "work" },
		{ openai: 1 },
		{ openai: { key: "not-a-slot" } },
	]) {
		expect(Check(SessionModelsSchema, { credentialSlots }), JSON.stringify(credentialSlots)).toBe(false);
		expect(() => agentConfig({ credentialSlots })).toThrow();
		expect(() => agentConfig({}, { credentialSlots })).toThrow();
		expect(() =>
			parsePresetConfig(
				JSON.stringify({ schema: 1, description: "Slot configuration check", credentialSlots }),
				"slots",
			),
		).toThrow();
	}
});

test("merge is per provider, explicit default wins, empty maps preserve inheritance and inputs stay unchanged", () => {
	const defaults = { credentialSlots: { openai: "work", anthropic: "personal" } };
	const profile = { credentialSlots: { openai: "default", google: "project" } };
	const before = structuredClone({ defaults, profile });
	const resolved = resolveProfile(profile, defaults);
	expect(resolved.credentialSlots).toEqual({ openai: "default", anthropic: "personal", google: "project" });
	expect(resolveProfile({ credentialSlots: {} }, defaults).credentialSlots).toEqual(defaults.credentialSlots);
	expect(resolveProfile({}).credentialSlots).toEqual({});
	expect(mergeCredentialSlots(defaults.credentialSlots, profile.credentialSlots, { google: "default" })).toEqual({
		openai: "default",
		anthropic: "personal",
		google: "default",
	});
	resolved.credentialSlots.openai = "changed";
	expect({ defaults, profile }).toEqual(before);
});

test("presets inherit tools and capabilities, never the parent's model accounts", () => {
	const parent = resolveProfile({ level: "bypass", credentialSlots: { openai: "parent", anthropic: "parent" } });
	const selected = { credentialSlots: { openai: "child" } };
	const saved = presetSession(selected, "local", parent);
	expect(saved.inherit).not.toHaveProperty("credentialSlots");
	expect(presetProfile(selected, "local", saved.capabilities, saved.inherit).credentialSlots).toEqual({
		openai: "child",
	});
	expect(presetProfile({}, "local", saved.capabilities, saved.inherit).credentialSlots).toEqual({});
	expect(parent.credentialSlots).toEqual({ openai: "parent", anthropic: "parent" });
});

test("real session resolver merges saved session maps over defaults/profile without inheriting parent slots into tasks", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const agent = agentConfig(
			{ credentialSlots: { openai: "base", anthropic: "base" } },
			{ credentialSlots: { openai: "profile" } },
		);
		const models: SessionModels = { credentialSlots: { openai: "default", google: "session" } };
		const runtime = {
			sessionState: async (id: string) =>
				id === "1" ? { models } : { cwd: "/tmp", env: "local", capabilities: ["read"] },
		} as unknown as Runtime;
		const preset: Preset = {
			id: "slots",
			description: "Slot configuration check",
			credentialSlots: { openai: "preset" },
		};
		const sessions = createSessions({
			store,
			agents: new Map([["main", agent]]),
			homePresets: new Map([[preset.id, preset]]),
			pluginPresets: new Map(),
			home: "/tmp",
			config: { schema: 1, defaultModel: testModel, agents: [{ id: "main", workspace: "main" }] },
			version: "check",
			runtime: () => runtime,
		});
		for (const row of [
			{ id: "1", agent: "main", mode: "main" as const, profile: "owner" },
			{ id: "2", agent: null, mode: "task" as const, profile: "slots", parent: "1" },
		])
			await store.sessions.put({ ...row, key: row.id, version: "check", opened: new Date().toISOString() });
		expect((await sessions.resolveSession("1")).resolved.credentialSlots).toEqual({
			openai: "default",
			anthropic: "base",
			google: "session",
		});
		expect((await sessions.resolveSession("2")).resolved.credentialSlots).toEqual({ openai: "preset" });
		expect(agent.defaults?.credentialSlots).toEqual({ openai: "base", anthropic: "base" });
	} finally {
		await db.close();
	}
});
