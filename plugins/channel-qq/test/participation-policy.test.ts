import type { PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { GroupParticipation } from "../src/participation.js";

test("group admission defaults to all and honors configured overrides", () => {
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
		"conv:qq:group:default",
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
		{ groupParticipation: { g: "mention" } },
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

test("a plain message is not an @ and bot messages remain background", () => {
	const groups = new GroupParticipation({} as PluginAPI, "qq", 3, {
		groupParticipation: { mention: "mention" },
	});
	const timestamp = Date.now();
	const accept = (id: string, group: string, mentioned: boolean, senderIsBot = false) =>
		groups.accept({
			id,
			ts: new Date(timestamp).toISOString(),
			type: "message.in",
			conv: `conv:qq:group:${group}`,
			data: { kind: "group", text: "在吗", mentioned, senderIsBot },
			routes: [{ agent: "main", binding: "group", wake: "write" }],
		} as YEvent);
	accept("1", "mention", false);
	accept("2", "ordinary", false);
	accept("3", "bot", true, true);
	const due = Object.fromEntries(groups.status().map((state) => [state.conv, state.nextAt]));
	expect(due["conv:qq:group:mention"]).toBeUndefined();
	expect(due["conv:qq:group:ordinary"]).toBe(new Date(timestamp + 3000).toISOString());
	expect(due["conv:qq:group:bot"]).toBeUndefined();
	accept("4", "ordinary", true);
	const immediate = groups.status().find((state) => state.conv === "conv:qq:group:ordinary")?.nextAt;
	expect(Date.parse(immediate ?? "")).toBeLessThan(timestamp + 3000);
	groups.stop();
});
