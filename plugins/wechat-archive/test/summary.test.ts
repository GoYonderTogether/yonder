import { expect, test } from "vitest";
import { batchSummary } from "../src/archive.js";

// 结构取自本机真实归档的 safeMessage 投影（wechat-context history --normalized），内容脱敏：
// sender 可为空字符串，direction 可为 unknown，纯媒体消息 text 为空。
const message = (overrides: Record<string, unknown> = {}) => ({
	id: 538813,
	chat: "Msg_0000000000000000000000000000000a",
	text: "",
	timestamp: 1792749248,
	sender: null,
	direction: "incoming",
	truncated: false,
	media: { kind: "unknown", parsed: false },
	...overrides,
});

test("batch summary names the sender and shortens the body", () => {
	expect(batchSummary([message({ text: "晚上七点老地方", sender: "好友A" })])).toBe("好友A: 晚上七点老地方");
	expect(batchSummary([message({ text: "  " })])).toBe("[无正文]");
	expect(batchSummary([message({ sender: "好友A", media: { kind: "image", parsed: false } })])).toBe("好友A: [image]");
	expect(batchSummary([message({ text: "x".repeat(200), sender: "好友A" })])).toBe(`好友A: ${"x".repeat(60)}`);
	expect(batchSummary([])).toBe("");
});

test("batch summary counts messages, lists senders and prefers incoming ones", () => {
	expect(
		batchSummary([
			message({ text: "好", sender: "好友A" }),
			message({ text: "收到", sender: "好友B" }),
			message({ text: "我这边行", sender: "我", direction: "outgoing" }),
		]),
	).toBe("2 条消息（好友A、好友B）：收到");
	expect(batchSummary([message({ text: "我这边行", sender: "我", direction: "outgoing" })])).toBe("我: 我这边行");
	expect(batchSummary([message({ text: "a", sender: "" }), message({ text: "b", sender: "" })])).toBe("2 条消息：b");
});
