import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import { createSocial } from "./social.js";

test("owner confirmation gates policy change, persists it, and records rejection and application", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-social-policy-"));
	try {
		const file = join(home, "agent.yaml");
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
			social: {
				enabled: true,
				authorized: { conversations: ["conv:test:group"] },
				defaults: { group: { mode: "batch" } },
			},
		});
		await writeFile(file, raw);
		await writeFile(join(home, "yonder.yaml"), "{}");
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		const events: Array<{ data: object }> = [];
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			target: async () => ({ kind: "group" }),
			record: async (event) => {
				events.push(event);
			},
			validate: async () => {},
			reload: async () => {
				agents.set("main", parseAgentConfig(await readFile(file, "utf8")));
			},
		});
		const ctx = {
			agent: "main",
			session: "s",
			profile: "default",
			capabilities: ["read", "admin"],
			channelInstances: ["test"],
			event: {
				id: "one",
				type: "message.in",
				from: "acct:console:owner",
				conv: "conv:console:main",
				data: { kind: "dm", text: "change group" },
			},
		} as unknown as ToolContext;
		const initial = await service.inspect({ agent: "main", conv: "conv:test:group" }, ctx);
		const request = {
			agent: "main",
			conv: "conv:test:group",
			expectedRevision: initial.revision,
			patch: {
				mode: "mention" as const,
				triggers: { regex: ["^设计|界面$"], exclude: ["广告"], minLength: 2, maxLength: 2048 },
			},
			reason: "owner request",
		};
		await service.update(request, ctx);
		await expect(service.update({ ...request, dryRun: false }, ctx)).rejects.toThrow("separate message");
		await service.update(request, ctx);
		const confirmed = { ...ctx, event: { ...ctx.event!, id: "two", data: { kind: "dm", text: "确认" } } };
		await service.update({ ...request, dryRun: false }, confirmed);
		expect(parseAgentConfig(await readFile(file, "utf8")).social?.conversations?.[request.conv]?.mode).toBe("mention");
		expect(parseAgentConfig(await readFile(file, "utf8")).social?.conversations?.[request.conv]?.triggers).toEqual(
			request.patch.triggers,
		);
		expect(events.map((e) => (e.data as { result: string }).result)).toEqual(["rejected", "applied"]);
		await expect(service.update({ ...request, dryRun: false }, confirmed)).rejects.toThrow();
		await service.auditDenied(
			{ id: "gateway:remote", kind: "remote", transport: "gateway", scopes: ["read"] },
			{ conv: "conv:test:group", reason: "secret" },
			"forbidden",
		);
		expect(events.at(-1)?.data).toEqual({
			actor: "gateway:remote",
			before: {},
			after: {},
			reason: "forbidden",
			revision: "unknown",
			result: "rejected",
		});
		const saved = await readFile(file, "utf8");
		const current = await service.inspect({ agent: "main", conv: request.conv }, ctx);
		for (const triggers of [{ regex: ["["] }, { regex: ["(a+)+"] }, { minLength: 20, maxLength: 10 }]) {
			for (const dryRun of [true, false]) {
				await expect(
					service.update({ ...request, expectedRevision: current.revision, patch: { triggers }, dryRun }, ctx),
				).rejects.toMatchObject({ code: "invalid_params" });
				expect(await readFile(file, "utf8")).toBe(saved);
				expect((await service.inspect({ agent: "main", conv: request.conv }, ctx)).revision).toBe(current.revision);
			}
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("bot gate injects a low-weight hint only after bot chatter crosses the window threshold", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-social-gate-"));
	try {
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
			social: { enabled: true, authorized: { conversations: ["conv:test:group"] } },
		});
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		const recorded: Array<{ type: string; conv?: string; data: object }> = [];
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			target: async () => ({ kind: "group" }),
			record: async (event) => {
				recorded.push(event);
			},
			validate: async () => {},
			reload: async () => {},
		});
		const now = Date.parse("2026-10-29T12:00:00.000Z");
		const minutesAgo = (minutes: number) => now - minutes * 60_000;
		const bots = (minutes: number[]) => minutes.map((minute) => ({ at: minutesAgo(minute), bot: true }));
		// 一个 15 分钟窗口里 3 条机器人消息正好等于阈值，不触发也不记账。
		const quiet = await service.botGate({ agent: "main", conv: "conv:test:group", events: bots([13, 7, 1]), now });
		expect(quiet).toEqual({ inject: false, frequencies: [0, 0, 0] });
		expect(recorded).toHaveLength(0);
		// 第 4 条触发：附前 3 个窗口的频率，记一条低权重的结构化事件供下一回合使用。
		const gated = await service.botGate({
			agent: "main",
			conv: "conv:test:group",
			events: bots([44, 31, 13, 12, 7, 1]),
			now,
		});
		expect(gated).toEqual({
			inject: true,
			frequencies: [0, 2, 0],
			hint: { windowMin: 15, threshold: 3, count: 4, frequencies: [0, 2, 0] },
		});
		expect(recorded.at(-1)).toMatchObject({
			type: "social.bot-gate",
			conv: "conv:test:group",
			data: { agent: "main", source: "bot", weight: "low", count: 4 },
		});
		// 真人的消息不计入机器人频率。
		const humans = [13, 7, 1].map((minute) => ({ at: minutesAgo(minute), bot: false }));
		expect(
			await service.botGate({ agent: "main", conv: "conv:test:group", events: [...bots([13, 7]), ...humans], now }),
		).toMatchObject({ inject: false });
		await expect(service.botGate({ agent: "ghost", conv: "conv:test:group", events: [], now })).rejects.toThrow(
			"Unknown agent",
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
