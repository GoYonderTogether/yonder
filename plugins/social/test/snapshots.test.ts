import { expect, test } from "vitest";
import type { Batch, ModeMessage } from "../src/modes.js";
import { judgeModel, parseJudgement, queueFromEvent, Snapshots } from "../src/snapshots.js";

/**
 * 判定端口是插件注入的接缝：这里用固定回执验证合并/丢弃/记账逻辑，
 * 真模型（glm-5.3-flash）的一次判定在 verify-home 验收 HOME 里跑，不用假模型顶替。
 */
function judgeWith(action: "ignore" | "summarize" | "participate" | "none") {
	const requests: string[] = [];
	const judge = async (request: { conv: string; messages: ModeMessage[] }) => {
		requests.push(request.conv);
		if (action === "none") return undefined;
		return { action, sourceEvents: request.messages.map((message) => message.id), reason: "test" };
	};
	return { judge, requests };
}

let seq = 0;
function message(text: string): ModeMessage {
	seq++;
	return { id: `m${seq}`, at: seq * 1000, text };
}

function batch(conv: string, texts: string[], trigger: Batch["trigger"]): Batch {
	return { conv, messages: texts.map(message), trigger };
}

const conv = "conv:qq:group:a";

test("低价值闲聊批被丢弃并记账", async () => {
	const { judge, requests } = judgeWith("ignore");
	const snapshots = new Snapshots({ judge });
	expect(await snapshots.push(batch(conv, ["今天天气不错"], "window"))).toEqual({ kind: "dropped" });
	expect(snapshots.ledger).toEqual({ judged: 1, dropped: 1, held: 0, replied: 0, injected: 0 });
	expect(snapshots.pending(conv)).toBe(0);
	expect(requests).toEqual([conv]);
});

test("@ 批必须回复，快照包含全部未读并一次取走", async () => {
	const { judge } = judgeWith("summarize");
	const snapshots = new Snapshots({ judge });
	expect((await snapshots.push(batch(conv, ["一", "二"], "window"))).kind).toBe("held");
	expect(snapshots.pending(conv)).toBe(2);
	const outcome = await snapshots.push(batch(conv, ["三 @bot 帮看下"], "mention"));
	expect(outcome).toMatchObject({ kind: "replied", reason: "mention" });
	expect(outcome.kind === "replied" && outcome.unread.map((message) => message.text)).toEqual([
		"一",
		"二",
		"三 @bot 帮看下",
	]);
	expect(snapshots.pending(conv)).toBe(0);
	expect(snapshots.ledger).toMatchObject({ judged: 2, held: 1, replied: 1, injected: 3 });
});

test("超频不调模型，合并进快照等下次回复一起注入", async () => {
	const { judge, requests } = judgeWith("participate");
	const snapshots = new Snapshots({ judge });
	expect(await snapshots.push(batch(conv, ["一"], "window"), { overRate: true })).toEqual({ kind: "held" });
	expect(await snapshots.push(batch(conv, ["二"], "window"), { overRate: true })).toEqual({ kind: "held" });
	expect(requests).toEqual([]);
	expect(snapshots.snapshot(conv)).toMatchObject({ batches: 2, messages: [{ text: "一" }, { text: "二" }] });
	const outcome = await snapshots.push(batch(conv, ["三 @bot"], "mention"));
	expect(outcome.kind === "replied" && outcome.unread.length).toBe(3);
	expect(snapshots.ledger).toMatchObject({ judged: 1, held: 2, replied: 1, injected: 3 });
});

test("判定没有可用输出时暂存，不丢消息", async () => {
	const { judge } = judgeWith("none");
	const snapshots = new Snapshots({ judge });
	expect(await snapshots.push(batch(conv, ["一"], "key"))).toEqual({ kind: "held" });
	expect(snapshots.pending(conv)).toBe(1);
	expect(snapshots.ledger).toMatchObject({ judged: 1, held: 1, dropped: 0 });
});

test("判定模型默认 cheap，可被插件配置覆盖", () => {
	expect(judgeModel(undefined)).toBe("cheap");
	expect(judgeModel({ judge: { model: "glm-5.3-flash" } })).toBe("glm-5.3-flash");
	const snapshots = new Snapshots({ judge: async () => undefined, model: "workbuddy" });
	expect(snapshots.model).toBe("workbuddy");
});

test("判定输出校验：动作、来源事件与理由都要合法", () => {
	expect(parseJudgement('{"action":"participate","sourceEvents":["a"],"reason":"the owner asked"}', ["a"])).toEqual({
		action: "participate",
		sourceEvents: ["a"],
		reason: "the owner asked",
	});
	expect(parseJudgement("not json", ["a"])).toBeUndefined();
	expect(parseJudgement('{"action":"reply","sourceEvents":["a"],"reason":"x"}', ["a"])).toBeUndefined();
	expect(parseJudgement('{"action":"ignore","sourceEvents":["b"],"reason":"x"}', ["a"])).toBeUndefined();
	expect(parseJudgement('{"action":"ignore","sourceEvents":["a"]}', ["a"])).toBeUndefined();
});

test("真实模型的围栏/前后说明也能解析", () => {
	expect(parseJudgement('```json\n{"action":"ignore","sourceEvents":[],"reason":"成员日常闲聊"}\n```', ["a"])).toEqual({
		action: "ignore",
		sourceEvents: [],
		reason: "成员日常闲聊",
	});
	expect(
		parseJudgement('判定如下：\n```json\n{"action":"participate","sourceEvents":["a"],"reason":"问到主人"}\n```', [
			"a",
		]),
	).toMatchObject({ action: "participate", sourceEvents: ["a"] });
	expect(parseJudgement("没有 JSON", ["a"])).toBeUndefined();
});

test("只接管带 messages 与 trigger 的批次事件", () => {
	const messages = [message("一")];
	expect(queueFromEvent({ conv, data: { messages, trigger: "window" } })).toEqual({
		conv,
		messages,
		trigger: "window",
	});
	expect(queueFromEvent({ conv, data: { msgId: "batch:x", through: "m1" } })).toBeUndefined();
	expect(queueFromEvent({ conv, data: { messages: [], trigger: "window" } })).toBeUndefined();
	expect(queueFromEvent({ data: { messages, trigger: "window" } })).toBeUndefined();
});
