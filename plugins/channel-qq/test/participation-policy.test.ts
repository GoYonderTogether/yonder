import type { PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { GroupParticipation } from "../src/participation.js";

test("group admission schedules only configured triggers and keeps authorized groups", () => {
	const groups = new GroupParticipation({} as PluginAPI, "qq", 60, {
		allowedGroups: ["authorized"],
		groupParticipation: { quiet: "record", explicit: "all", mention: "mention" },
		groupKeywords: ["urgent"],
	});
	const accept = (group: string, text: string, mentioned = false) =>
		groups.accept({
			id: `${group}-${text}`,
			ts: new Date().toISOString(),
			type: "message.in",
			conv: `conv:qq:group:${group}`,
			data: { kind: "group", text, mentioned },
			routes: [{ agent: "main", binding: "group", wake: "write" }],
		} as YEvent);
	accept("default", "ordinary");
	accept("quiet", "urgent", true);
	accept("authorized", "ordinary");
	accept("explicit", "ordinary");
	accept("mention", "urgent");
	accept("direct", "hello", true);
	const scheduled = groups
		.status()
		.filter((state) => state.nextAt)
		.map((state) => state.conv);
	expect(scheduled).toEqual([
		"conv:qq:group:authorized",
		"conv:qq:group:explicit",
		"conv:qq:group:mention",
		"conv:qq:group:direct",
	]);
	groups.stop();
});

test("conflicting old and new mention facts do not trigger participation", () => {
	const warnings: unknown[] = [];
	const groups = new GroupParticipation(
		{ log: { warn: (...args: unknown[]) => warnings.push(args) } } as unknown as PluginAPI,
		"qq",
		60,
	);
	groups.accept({
		id: "1",
		ts: new Date().toISOString(),
		type: "message.in",
		conv: "conv:qq:group:g",
		data: { mentioned: true, social: { mentions: { bot: false } } },
		routes: [{ wake: "write" }],
	} as YEvent);
	expect(groups.status()[0]?.nextAt).toBeUndefined();
	expect(warnings).toHaveLength(1);
	groups.stop();
});

test("a linked person's plain message in a mention-mode group triggers now; record mode stays quiet", () => {
	const groups = new GroupParticipation({} as PluginAPI, "qq", 60, { groupParticipation: { quiet: "record" } });
	const accept = (group: string, owner: boolean) =>
		groups.accept(
			{
				id: group,
				ts: new Date().toISOString(),
				type: "message.in",
				conv: `conv:qq:group:${group}`,
				data: { kind: "group", text: "在吗", mentioned: false },
				routes: [{ agent: "main", binding: "group", wake: "write" }],
			} as YEvent,
			true,
			owner,
		);
	accept("stranger", false);
	accept("owner", true);
	accept("quiet", true);
	const due = Object.fromEntries(groups.status().map((s) => [s.conv, s.nextAt]));
	expect(due["conv:qq:group:stranger"]).toBeUndefined();
	expect(due["conv:qq:group:owner"]).toBeDefined();
	expect(due["conv:qq:group:quiet"]).toBeUndefined();
	groups.stop();
});
