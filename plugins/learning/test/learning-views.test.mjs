import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "vitest";
import { createLearningViews } from "../src/learning-views.mjs";
import { editMemory, readMemory } from "../src/store.mjs";
import { fixture, scope } from "./helpers.mjs";

test("review changes can be undone without overwriting later edits", async (t) => {
	const root = await fixture(t),
		s = scope(root);
	let provider;
	const api = {
		id: "learning",
		paths: { data: join(root, "data") },
		invalidate() {},
		views: {
			register(_decl, p) {
				provider = p;
			},
		},
		sessions: {
			async get() {
				return { agent: "alpha", profile: "owner" };
			},
		},
	};
	const views = createLearningViews(api, [s], {
		async status() {
			return null;
		},
	});
	views.register();
	const initial = await readMemory(s.memoryDir, "memory");
	await editMemory(
		s.memoryDir,
		{ target: "memory", revision: initial.revision, action: "add", content: "learned" },
		undefined,
		undefined,
		{ onChange: (change) => views.record("1", change) },
	);
	const data = await provider.data("1");
	await provider.act("undo", { id: data.content.items[1].id }, "1");
	assert.deepEqual((await readMemory(s.memoryDir, "memory")).entries, initial.entries);
});

test("created skill is archived on undo and changed skills are protected", async (t) => {
	const root = await fixture(t),
		s = scope(root, { learning: true, skillDir: join(root, "skills") });
	let provider;
	const api = {
		id: "learning",
		paths: { data: join(root, "data") },
		invalidate() {},
		views: {
			register(_decl, p) {
				provider = p;
			},
		},
		sessions: {
			async get() {
				return { agent: "alpha", profile: "owner" };
			},
		},
	};
	const views = createLearningViews(api, [s], {
		async status() {
			return null;
		},
	});
	views.register();
	const { skillStore } = await import("../src/skill-store.mjs");
	await skillStore(
		s.skillDir,
		{ action: "create", name: "hermes-learned-weekly", description: "Weekly format", body: "Steps" },
		undefined,
		{ onChange: (change) => views.record("1", change) },
	);
	const data = await provider.data("1");
	await provider.act("undo", { id: data.content.items[1].id }, "1");
	assert.equal((await skillStore(s.skillDir, { action: "read", name: "hermes-learned-weekly" })).content, null);
});


test("review proposal stays inactive until confirmation and can be undone", async (t) => {
 const root = await fixture(t), s = scope(root);
 let provider;
 const api = { id: "learning", paths: { data: join(root, "data") }, invalidate() {}, views: { register(_decl, p) { provider = p; } }, sessions: { async get() { return { agent: "alpha", profile: "owner" }; } } };
 const views = createLearningViews(api, [s], { async status() { return null; } });
 views.register();
 const initial = await readMemory(s.memoryDir, "memory");
 const proposal = await views.propose("1", { kind: "memory", args: { target: "memory", revision: initial.revision, action: "add", content: "verified" }, source: { session: "1", run: "run-1" }, evidence: "verified command output" });
 assert.deepEqual((await readMemory(s.memoryDir, "memory")).entries, initial.entries);
 assert.match((await provider.data("1")).content.items[1].subtitle, /run-1/);
 await provider.act("confirm", { id: proposal.id }, "1");
 assert.match((await readMemory(s.memoryDir, "memory")).entries.at(-1), /verified[\s\S]*run-1[\s\S]*置信度/);
 const data = await provider.data("1");
 await provider.act("undo", { id: data.content.items.at(-1).id }, "1");
 assert.deepEqual((await readMemory(s.memoryDir, "memory")).entries, initial.entries);
});
