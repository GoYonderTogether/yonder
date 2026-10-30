import type { PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { judgeGroup, parseGroupDecision, speakers } from "../src/group-judge.js";
import { Groups } from "../src/groups.js";

const decision = {
	multiple: false,
	silenced: [],
	decisions: [
		{ agent: "a", probability: 0.7, action: "continue" },
		{ agent: "b", probability: 0.8, action: "speak" },
	],
	reason: "one answer suffices",
};

test("one shared decision gates continue as well as new speech, at inclusive 50 percent", () => {
	expect(speakers(parseGroupDecision(JSON.stringify(decision), ["a", "b"]))).toEqual(["b"]);
	expect(speakers({ ...decision, multiple: true })).toEqual(["a", "b"]);
	expect(
		speakers({
			multiple: false,
			silenced: [],
			decisions: [{ agent: "a", probability: 0.5, action: "speak" }],
			reason: "",
		}),
	).toEqual(["a"]);
});

test("unknown, duplicate, missing candidates and invalid decisions are rejected", () => {
	for (const decisions of [
		[decision.decisions[0], decision.decisions[0]],
		[{ agent: "unknown", probability: 0.7, action: "speak" }, decision.decisions[1]],
		[{ ...decision.decisions[0], probability: 2 }, decision.decisions[1]],
		[{ ...decision.decisions[0], action: "execute" }, decision.decisions[1]],
		[decision.decisions[0]],
	])
		expect(() => parseGroupDecision(JSON.stringify({ ...decision, decisions }), ["a", "b"])).toThrow(
			"Invalid group judgment",
		);
});

test("judgment never falls back to an ordinary model when cheap is missing", async () => {
	let calls = 0;
	const api = {
		sessions: {
			open: async (request: { judgment: boolean }) => {
				calls++;
				expect(request.judgment).toBe(true);
				throw new Error("Judgment requires cheap");
			},
		},
	} as unknown as PluginAPI;
	await expect(judgeGroup(api, "judge", "group", {}, ["a"])).rejects.toThrow("requires cheap");
	expect(calls).toBe(1);
});

const source = (id: string, agent: string, conv: string, mentioned = false, senderIsBot = false): YEvent => ({
	id,
	ts: new Date().toISOString(),
	type: "message.in",
	conv,
	data: { kind: "group", mentioned, senderIsBot, msgId: id, social: { room: "card:shared" } },
	routes: [{ agent, session: `session:${agent}`, binding: "group", wake: mentioned ? "run" : "write" }],
});

test("new human snapshot blocks old sends but never blocks another room or private chat", () => {
	const groups = new Groups({} as PluginAPI, {
		preset: "judge",
		conversations: ["conv:card:a:room", "conv:card:b:room"],
	});
	const conv = "conv:card:a:room";
	groups.observe(source("1", "a", conv, true));
	expect(() => groups.beforeSend(conv, { agent: "a", session: "session:a" })).not.toThrow();
	groups.observe(source("2", "a", conv));
	expect(() => groups.beforeSend(conv, { agent: "a", session: "session:a" })).toThrow("不要重试");
	expect(() => groups.beforeSend("conv:card:a:private", { agent: "a", session: "session:a" })).not.toThrow();
});

test("brother Bot background does not invalidate an admitted reply", () => {
	const groups = new Groups({} as PluginAPI, {
		preset: "judge",
		conversations: ["conv:card:a:room", "conv:card:b:room"],
	});
	const conv = "conv:card:a:room";
	groups.observe(source("1", "a", conv, true));
	groups.observe(source("2", "b", "conv:card:b:room", false, true));
	expect(() => groups.beforeSend(conv, { agent: "a", session: "session:a" })).not.toThrow();
});

test("a new direct mention does not revive another Bot's old permission", () => {
	const groups = new Groups({} as PluginAPI, {
		preset: "judge",
		conversations: ["conv:card:a:room", "conv:card:b:room"],
	});
	groups.observe(source("1", "a", "conv:card:a:room", true));
	groups.observe(source("2", "b", "conv:card:b:room", true));
	expect(() => groups.beforeSend("conv:card:a:room", { agent: "a", session: "session:a" })).toThrow("不要重试");
	expect(() => groups.beforeSend("conv:card:b:room", { agent: "b", session: "session:b" })).not.toThrow();
});

test("silenced identities cannot become speakers just because a score is high", () => {
	expect(speakers({ ...decision, silenced: ["b"] })).toEqual(["a"]);
});

test("QQ @ grant survives other app fanout without granting their unaddressed candidates", () => {
	const groups = new Groups({} as PluginAPI, {
		preset: "judge",
		rooms: [["conv:qq-a:group:x", "conv:qq-b:group:y", "conv:qq-c:group:z"]],
	});
	const event = (id: string, agent: string, conv: string, mentioned: boolean) => {
		const e = source(id, agent, conv, mentioned);
		e.data = { kind: "group", mentioned, social: { mentions: { bot: mentioned } } };
		return e;
	};
	groups.observe(event("1", "a", "conv:qq-a:group:x", true));
	groups.observe(event("2", "b", "conv:qq-b:group:y", false));
	groups.observe(event("3", "c", "conv:qq-c:group:z", false));
	expect(() => groups.beforeSend("conv:qq-a:group:x", { agent: "a", session: "session:a" })).not.toThrow();
	expect(() => groups.beforeSend("conv:qq-b:group:y", { agent: "b", session: "session:b" })).toThrow("不要重试");
	groups.observe(event("4", "a", "conv:qq-a:group:x", false));
	expect(() => groups.beforeSend("conv:qq-a:group:x", { agent: "a", session: "session:a" })).toThrow("不要重试");
});
