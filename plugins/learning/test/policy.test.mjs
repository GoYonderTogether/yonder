import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { test } from "vitest";
import plugin from "../src/index.mjs";
import { fixture, scope } from "./helpers.mjs";
import { setup, until } from "./review-fixture.mjs";

const RELATIONS = { "acct:t:owner": "owner", "acct:t:friend": "known" };
const ev = (from, kind = "dm") => ({
	id: `e-${from}-${kind}`,
	type: "message.in",
	from,
	conv: "conv:t:c",
	data: { text: "hi", kind },
});
const ctxOf = (agent, ...events) => ({
	agent,
	profile: "owner",
	session: "s1",
	capabilities: ["read", "write"],
	env: {},
	signal: new AbortController().signal,
	events,
	event: events[0],
});
// Home layout is what core gives plugins: <home>/.yonder/plugins/learning.
async function boot(t, config = {}) {
	const home = await fixture(t),
		c = createRegistrationCollector();
	await plugin.setup({
		...c.api,
		id: "learning",
		config,
		paths: { data: join(home, ".yonder/plugins/learning") },
		identity: { relation: async (_agent, account) => RELATIONS[account] ?? "stranger" },
	});
	const tool = Object.fromEntries(c.registrations.tools.map((x) => [x.name, x]));
	const run = async (name, args, ctx) => {
		const r = await tool[name].execute(args, ctx);
		return { ...JSON.parse(r.text), isError: r.isError };
	};
	const add = async (agent, target, content, ...events) => {
		const ctx = ctxOf(agent, ...events),
			read = await run("learning_memory_read", { target }, ctx);
		if (read.isError) return read;
		return run("learning_memory_edit", { target, action: "add", revision: read.revision, content }, ctx);
	};
	return { home, c, run, add, ctx: ctxOf };
}

test("default on: an agent with no scope gets <home>/agents/<id>/{memories,skills}", async (t) => {
	const b = await boot(t);
	const r = await b.add("bot1", "memory", "DEFAULT_FACT");
	assert.ok(!r.isError, JSON.stringify(r));
	assert.match(await readFile(join(b.home, "agents/bot1/memories/MEMORY.md"), "utf8"), /DEFAULT_FACT/);
	assert.ok(existsSync(join(b.home, "agents/bot1/skills")));
	assert.ok(!existsSync(join(b.home, "agents/bot2")), "only agents that act are provisioned");
});
test("explicit off: agents.<id>.learning=false denies, other Bots stay on", async (t) => {
	const b = await boot(t, { agents: { quiet: { learning: false }, gone: { enabled: false } } });
	for (const id of ["quiet", "gone"]) assert.equal((await b.add(id, "memory", "x")).error, "scope_denied");
	assert.ok(!(await b.add("loud", "memory", "x")).isError);
	assert.ok(!existsSync(join(b.home, "agents/quiet")));
});
test("explicit scope is kept as configured; no convention directories appear for it", async (t) => {
	const home = await fixture(t),
		b = await boot(t, { scopes: [scope(home, { agent: "hermes", profiles: ["owner"], user: false })] });
	assert.ok(!(await b.add("hermes", "memory", "KEPT")).isError);
	assert.equal((await b.add("hermes", "user", "x")).error, "target_disabled");
	assert.ok(!existsSync(join(b.home, "agents/hermes")));
	// an agent mentioned by an explicit scope never falls through to the convention for another profile
	const other = b.ctx("hermes", ev("acct:t:owner"));
	other.profile = "side";
	assert.equal((await b.run("learning_memory_read", { target: "memory" }, other)).error, "scope_denied");
});
test("presets and per-field override", async (t) => {
	const b = await boot(t, {
		agents: {
			worker: { preset: "worker" },
			worker2: { preset: "worker", user: true },
			persona: { preset: "persona" },
			mute: { memory: false },
		},
	});
	assert.ok(!(await b.add("worker", "memory", "m")).isError);
	assert.equal((await b.add("worker", "user", "u")).error, "target_disabled");
	assert.ok(!(await b.add("worker2", "user", "u")).isError);
	assert.ok(!(await b.add("persona", "user", "u")).isError);
	assert.equal((await b.add("mute", "memory", "m")).error, "target_disabled");
	assert.ok(!(await b.add("mute", "user", "u")).isError);
});
test("conversation trust: owner DM writes; group has no USER and no skills; stranger writes nothing", async (t) => {
	const b = await boot(t);
	const owner = ev("acct:t:owner"),
		friendGroup = ev("acct:t:friend", "group"),
		ownerGroup = ev("acct:t:owner", "group"),
		stranger = ev("acct:t:nobody"),
		publicChannel = ev("acct:t:owner", "channel");
	assert.ok(!(await b.add("bot", "user", "profile", owner)).isError);
	for (const e of [friendGroup, ownerGroup]) {
		assert.ok(!(await b.add("bot", "memory", `group-${e.id}`, e)).isError);
		assert.equal((await b.add("bot", "user", "p", e)).error, "target_disabled");
	}
	for (const e of [stranger, publicChannel]) {
		assert.equal((await b.add("bot", "memory", "m", e)).error, "target_disabled");
		assert.equal((await b.add("bot", "user", "p", e)).error, "target_disabled");
	}
	// a mixed run takes the lowest trust
	assert.equal((await b.add("bot", "user", "p", owner, stranger)).error, "target_disabled");
	// context render exposes nothing to a stranger
	const render = (e) =>
		b.c.registrations.contexts[0].render({ agent: "bot", profile: "owner", session: "s", event: e });
	assert.match(await render(owner), /profile/);
	assert.doesNotMatch(await render(friendGroup), /"user"/);
	assert.equal(await render(stranger), undefined);
	// external messages never write a skill directly
	const skill = { action: "create", name: "hermes-learned-x", content: "x" };
	for (const e of [friendGroup, stranger]) {
		const r = await b.run("learning_skill_store", skill, b.ctx("bot", e));
		assert.equal(r.error, "skills_write_denied_for_conversation");
	}
	const r = await b.run("learning_skill_store", skill, b.ctx("bot", owner));
	assert.notEqual(r.error, "skills_write_denied_for_conversation");
});
test("review counters: stranger inputs never queue memory review, owner inputs do", async (t) => {
	const f = await setup(t);
	await f.turn({ from: "acct:test:owner", toolCalls: 3 });
	assert.deepEqual([(await f.counters()).memory, (await f.counters()).skills], [1, 3]);
	await f.turn({ from: "acct:test:stranger", toolCalls: 3 });
	const c = await f.counters();
	assert.equal(c.memory, 1);
	assert.equal(c.skills, 3, "stranger tool calls do not count toward skill review either");
});
test("review.model is passed as the session model fallback", async (t) => {
	const f = await setup(t, { review: { model: "p/cheap", toolCallThreshold: 2 } });
	f.setSubmit(() => new Promise(() => {}));
	await f.turn({ toolCalls: 2 });
	await f.tick(15000);
	await until(() => f.openRequests.length === 1);
	assert.deepEqual(f.openRequests[0].modelSource, { session: "parent", fallback: "p/cheap" });
});
