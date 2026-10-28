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
