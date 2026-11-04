import { describe, expect, test } from "vitest";
import {
	harnessMessage,
	harnessSession,
	harnessTranscript,
	harnessTranscriptPage,
	harnessUpdates,
} from "../src/adapter.js";
import { composeInput } from "../src/bots.js";
import { parseFrame } from "../src/frames.js";

describe("device frame parsing", () => {
	test("parses a cloud message with sender facts", () => {
		const frame = parseFrame(
			JSON.stringify({
				type: "message",
				agentId: "8a0d2c0b-0f3f-4a4e-9a63-1e5e0a1cbb11",
				convId: "0f3f4a4e-8a0d-2c0b-9a63-1e5e0a1cbb11",
				convKind: "dm",
				mentioned: true,
				replayed: true,
				message: {
					id: "m1",
					convId: "0f3f4a4e-8a0d-2c0b-9a63-1e5e0a1cbb11",
					seq: 7,
					senderId: "human-1",
					content: { type: "text", text: "hello" },
					createdAt: 1_700_000_000_000,
					senderName: "主人",
					senderIsBot: false,
				},
			}),
		);
		expect(frame).toMatchObject({ type: "message", convKind: "dm", mentioned: true, replayed: true });
	});

	test("ignores unknown and malformed frames instead of failing", () => {
		expect(parseFrame("not json")).toBeUndefined();
		expect(parseFrame({ type: "presence" })).toBeUndefined();
		expect(parseFrame({ type: "message", agentId: "a", convId: "c" })).toBeUndefined();
		expect(
			parseFrame({ type: "work.frame", channelId: "c", ownerId: "o", deviceId: "d", frame: { t: "ping" } }),
		).toMatchObject({
			type: "work.frame",
		});
	});

	test("an error frame without a ref cannot confirm a send", () => {
		const frame = parseFrame({ type: "error", error: "forbidden" });
		expect(frame).toEqual({ type: "error", error: "forbidden" });
	});
});

describe("message composition", () => {
	const message = {
		id: "m1",
		convId: "c",
		seq: 1,
		senderId: "s",
		content: { type: "text", text: "run the tests" },
		createdAt: 1_700_000_000_000,
		senderName: "主人",
	};
	const base = { type: "message", agentId: "a", convId: "c", convKind: "dm", mentioned: true, message };

	test("keeps the sender in the prompt", () => {
		const parsed = parseFrame(base);
		if (parsed?.type !== "message") throw new Error("expected message frame");
		expect(composeInput(parsed)).toBe("[Yonder 私聊 · 主人]\nrun the tests");
	});

	test("marks replayed messages so an old instruction is not taken for the current one", () => {
		const parsed = parseFrame({ ...base, replayed: true });
		if (parsed?.type !== "message") throw new Error("expected message frame");
		const input = composeInput(parsed);
		expect(input).toContain("[补收：这条消息发于 2023-11-14T22:13:20.000Z");
		expect(input?.endsWith("run the tests")).toBe(true);
	});

	test("reports content the harness cannot carry", () => {
		const parsed = parseFrame({
			...base,
			message: { ...message, content: { type: "interactive", title: "t", body: "b" } },
		});
		if (parsed?.type !== "message") throw new Error("expected message frame");
		expect(composeInput(parsed)).toBeUndefined();
	});
});

describe("session projection", () => {
	test("reads title, model, usage and turn count from DSH projections", () => {
		const session = harnessSession({
			sessionId: "session-1",
			updatedAt: 1_700_000_000_000,
			running: true,
			blank: false,
			cwd: "/work",
			projections: {
				kind: "sequenced",
				values: {
					title: "Fix the build",
					agentPreset: "standard",
					modelSelection: {
						lastUsed: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" },
					},
					contextPressure: { contextWindow: 1_048_576 },
					tokenUsage: { uncachedInputTokens: 10, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 0 },
					sessionStats: { turns: 2 },
				},
			},
		});
		expect(session).toMatchObject({
			id: "session-1",
			title: "Fix the build",
			running: true,
			cwd: "/work",
			agentPreset: "standard",
			usage: { input: 10, output: 3, cacheRead: 4, cacheWrite: 0 },
			turnCount: 2,
			model: { provider: "deepseek-official", model: "deepseek-flash", effort: "high", contextWindow: 1_048_576 },
		});
	});

	test("a missing session has no projection", () => {
		expect(harnessSession(undefined)).toBeUndefined();
		expect(harnessSession({ sessionId: "" })).toBeUndefined();
	});
});

describe("transcript projection", () => {
	const records = [
		{ event: { seq: 1, type: "permission/preset", time: 1, data: { preset: "workspace-write" } } },
		{
			event: {
				seq: 8,
				type: "user/message",
				time: 1,
				data: { content: [{ type: "text", text: "run the tests" }], source: { kind: "user" } },
			},
		},
		{
			event: {
				seq: 9,
				type: "user/message",
				time: 1,
				data: { content: [{ type: "text", text: "Current runtime context" }], source: { kind: "runtime-context" } },
			},
		},
		{
			event: {
				seq: 19,
				type: "assistant/message",
				time: 1,
				data: {
					message: {
						role: "assistant",
						content: [
							{ type: "reasoning", text: "thinking" },
							{ type: "text", text: "done" },
							{ type: "tool-call", id: "c1", name: "bash", arguments: '{"command":"ls"}' },
						],
					},
				},
			},
		},
		{
			event: {
				seq: 20,
				type: "tool/result",
				time: 1,
				data: { message: { role: "tool", toolCallId: "c1", content: [{ type: "text", text: "a.txt" }] } },
			},
		},
	];

	test("keeps human turns, assistant text, tools and results; injects no context", () => {
		const page = harnessTranscript(records);
		expect(page.items).toEqual([
			{ id: 8, kind: "yonder.message", text: "run the tests" },
			{ id: 19, kind: "pi.assistant", text: "done", tools: [{ name: "bash", args: { command: "ls" } }] },
			{ id: 20, kind: "pi.tool-result", text: "a.txt" },
		]);
	});

	test("carries hasMore from the DSH page", () => {
		expect(harnessTranscriptPage({ records, hasMore: true }).hasMore).toBe(true);
		expect(harnessTranscriptPage(undefined).items).toEqual([]);
	});
});

describe("message mapping", () => {
	test("maps reasoning blocks to the web reducer's thinking field", () => {
		const message = harnessMessage({
			role: "assistant",
			content: [
				{ type: "reasoning", text: "why" },
				{ type: "text", text: "answer" },
				{ type: "image", data: "…" },
			],
		});
		expect(message?.content).toEqual([
			{ type: "thinking", thinking: "why" },
			{ type: "text", text: "answer" },
		]);
	});

	test("maps a tool role to toolResult", () => {
		expect(harnessMessage({ role: "tool", content: [{ type: "text", text: "ok" }] })?.role).toBe("toolResult");
	});
});

describe("event reduction", () => {
	test("a user turn becomes one message update, injected context does not", () => {
		const updates = harnessUpdates({
			sessionId: "s",
			seq: 8,
			type: "user/message",
			time: 10,
			data: { content: [{ type: "text", text: "hello" }], source: { kind: "user" } },
		});
		expect(updates).toEqual([
			{
				type: "message",
				id: "8",
				message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 10 },
				streaming: false,
			},
		]);
		expect(
			harnessUpdates({
				sessionId: "s",
				seq: 9,
				type: "user/message",
				time: 10,
				data: { content: [{ type: "text", text: "snapshot" }], source: { kind: "runtime-context" } },
			}),
		).toEqual([]);
	});

	test("turn boundaries toggle running and surface real failures", () => {
		expect(harnessUpdates({ sessionId: "s", seq: 1, type: "turn/start", time: 1, data: { turn: 1 } })).toEqual([
			{ type: "state", running: true },
		]);
		expect(
			harnessUpdates({
				sessionId: "s",
				seq: 2,
				type: "turn/end",
				time: 1,
				data: { turn: 1, reason: { kind: "error", error: { message: "no API key" } } },
			}),
		).toEqual([
			{ type: "state", running: false },
			{ type: "error", error: "no API key" },
		]);
	});

	test("tool call and result become tool updates", () => {
		expect(
			harnessUpdates({
				sessionId: "s",
				seq: 3,
				type: "tool/call",
				time: 1,
				data: { callId: "c1", name: "bash", arguments: '{"command":"ls"}' },
			}),
		).toEqual([{ type: "tool", tool: { id: "c1", name: "bash", phase: "start", args: { command: "ls" } } }]);
		expect(
			harnessUpdates({
				sessionId: "s",
				seq: 4,
				type: "tool/result",
				time: 1,
				data: { message: { toolCallId: "c1", content: [{ type: "text", text: "a.txt" }] } },
			}),
		).toEqual([{ type: "tool", tool: { id: "c1", name: "", phase: "end", text: "a.txt" } }]);
	});
});
