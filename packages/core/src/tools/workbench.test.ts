import type { AskResult, SessionInfo, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import type { AgentConfig } from "../config/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";
import { createWorkbenchTools } from "./workbench.js";

const bot = "helper";
const sessions = new Map<string, SessionInfo>([
	[
		"base",
		{ id: "base", agent: null, profile: "default", mode: "task", key: "k1", version: "1", opened: "2026-10-29" },
	],
	[
		"bot-work",
		{
			id: "bot-work",
			agent: bot,
			profile: "default",
			mode: "main",
			key: "k2",
			version: "1",
			opened: "2026-10-29",
			owner: { kind: "bot", id: bot },
		},
	],
]);

function harness(answers: string[] = ["答复"]) {
	const calls: string[] = [];
	const asked: unknown[] = [];
	const agents = new Map<string, AgentConfig>([
		[
			bot,
			{
				id: bot,
				name: "Helper",
				bindings: [{ id: "c", match: { channel: "console", kind: "dm", from: "owner" }, session: "main" }],
			} as unknown as AgentConfig,
		],
	]);
	const tools = createWorkbenchTools({
		store: {
			sessions: {
				get: async (id: string) => sessions.get(id),
				list: async (filter: { agent?: string; mode?: string }) =>
					[...sessions.values()].filter((row) => row.agent === filter.agent && row.mode === filter.mode),
			},
		} as unknown as Store,
		agents,
		sessions: {
			workbench: {
				archive: async (id: string) => calls.push(`archive:${id}`),
				handUp: async (id: string, reason: string) => calls.push(`hand-up:${id}:${reason}`),
				attach: async (id: string, parent: string) => calls.push(`attach:${id}:${parent}`),
			},
		} as unknown as Sessions,
		ask: async (input) => {
			asked.push(input);
			return {
				event: { routes: [] },
				results: answers.map((text) => ({ agent: bot, session: "bot-work", status: "done", text })),
			} as unknown as AskResult;
		},
		runtime: () => ({ invocationId: () => "inv" }) as never,
	});
	const call = (name: string, params: unknown, agent: string | null, session = "base") =>
		tools
			.find((item) => item.name === name)!
			.execute(params, {
				agent,
				session,
				capabilities: [],
				signal: new AbortController().signal,
			} as unknown as ToolContext);
	return { call, calls, asked };
}

test("session tools gate on ownership and hand up Bot sessions only", async () => {
	const { call, calls } = harness();
	expect(await call("session_archive", {}, null)).toEqual({ text: JSON.stringify({ ok: true, session: "base" }) });
	expect(calls).toEqual(["archive:base"]);
	expect((await call("session_archive", { id: "bot-work" }, null)).isError).toBe(true);
	expect((await call("session_archive", {}, bot, "bot-work")).isError).toBeUndefined();
	expect(calls).toEqual(["archive:base", "archive:bot-work"]);
	expect((await call("session_hand_up", { reason: "要主人决定" }, null)).isError).toBe(true);
	expect(await call("session_hand_up", { reason: "要主人决定" }, bot, "bot-work")).toEqual({
		text: JSON.stringify({ ok: true, needsOwner: { reason: "要主人决定" } }),
	});
	expect(calls).toContain("hand-up:bot-work:要主人决定");
});

test("base session connects to a Bot, other sessions cannot", async () => {
	const { call, asked, calls } = harness(["好的"]);
	expect((await call("bot_ask", { bot, question: "在吗" }, bot, "bot-work")).isError).toBe(true);
	expect(await call("bot_ask", { bot, question: "在吗" }, null)).toEqual({ text: "好的" });
	expect(await call("bot_request", { bot, action: "重启", detail: "网关" }, null)).toEqual({ text: "好的" });
	expect(asked).toHaveLength(2);
	expect(asked[1]).toMatchObject({
		conv: `conv:console:${bot}`,
		data: { request: { action: "重启", detail: "网关" } },
	});
	expect((await call("bot_ask", { bot: "stranger", question: "在吗" }, null)).isError).toBe(true);
	expect(await call("bot_attach", { bot }, null)).toEqual({ text: JSON.stringify({ ok: true, parent: "bot-work" }) });
	expect(calls).toContain("attach:base:bot-work");
});
