import type { PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { sendGuard } from "../src/group-send-guard.js";
import type { TurnRoom } from "../src/group-turns.js";

const conv = "conv:qq:group";

function room(turn?: TurnRoom["turn"]): TurnRoom {
	return { id: "room", convs: new Set([conv]), ...(turn ? { turn } : {}), waiting: [], wake: new Set() };
}

test("send guard keeps no-turn recovery actionable without bypassing pause or superseded turns", async () => {
	const emitted: unknown[] = [];
	const answered = {
		id: "02",
		type: "message.out",
		conv,
		from: "acct:qq:other",
		data: { delivery: { ok: true }, session: "other-session" },
	} as unknown as YEvent;
	const api = {
		events: {
			query: async ({ type }: { type: string }) => ({ events: type === "message.out" ? [answered] : [] }),
			emit: async (event: unknown) => emitted.push(event),
		},
		sessions: { get: async () => ({ agent: "other-agent" }) },
	} as unknown as PluginAPI;
	const options = { to: conv, agent: "agent", session: "session", paused: false };

	const noTurn = await sendGuard(api, { ...options, room: room() });
	expect(noTurn).toContain("工具目录提供 parent_ask");
	expect(noTurn).toContain("明确报告未投递");
	expect(noTurn).toContain("自主评论不要借此绕过群协调");

	const paused = await sendGuard(api, { ...options, paused: true, room: room() });
	expect(paused).toContain("已暂停");
	expect(paused).not.toContain("parent_ask");

	const superseded = await sendGuard(api, {
		...options,
		room: room({
			agent: "agent",
			session: "session",
			direct: false,
			focused: false,
			source: "01",
			decision: "batch",
		}),
	});
	expect(superseded).toContain("已被可靠回应");
	expect(superseded).not.toContain("parent_ask");
	expect(emitted).toHaveLength(1);

	const currentTurn = await sendGuard(api, {
		...options,
		room: room({
			agent: "agent",
			session: "session",
			direct: true,
			source: "01",
			decision: "mention",
		}),
	});
	expect(currentTurn).toBeUndefined();
});
