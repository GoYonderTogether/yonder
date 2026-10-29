import { expect, test } from "vitest";
import { type ListenConfig, ListenModes, resolveListen } from "../src/modes.js";

const clockAt = (start = 0) => {
	let now = start;
	return { clock: { now: () => now }, at: (ms: number) => (now = ms) };
};

const listen = (override: Partial<ListenConfig>) => (conv: string) =>
	conv === "conv:qq:group:a" ? listenDefaults : resolveListen(override);
const listenDefaults: ListenConfig = {
	mode: "realtime",
	realtime: { quietSec: 15, maxWindowSec: 120 },
	batch: { windowSec: 300, keyRules: ["owner", "link", "image"] },
	digest: { windowMin: 15, minMessages: 5 },
	mention: { strong: true },
};

test("realtime：15 秒内续等，静默满 15 秒才出包", () => {
	const { clock, at } = clockAt();
	const modes = new ListenModes({ clock });
	const conv = "conv:qq:group:a";
	expect(modes.push(conv, { id: "1", text: "hi" })).toBeUndefined();
	at(14_999);
	expect(modes.push(conv, { id: "2", text: "still here" })).toBeUndefined();
	at(29_998);
	expect(modes.drain()).toEqual([]);
	at(29_999);
	expect(modes.drain()).toEqual([
		{ conv, messages: [expect.objectContaining({ id: "1" }), expect.objectContaining({ id: "2" })], trigger: "quiet" },
	]);
	expect(modes.pending(conv)).toBe(0);
});

test("realtime：最长 2 分钟一包，不因持续有新消息无限续等", () => {
	const { clock, at } = clockAt();
	const modes = new ListenModes({ clock });
	const conv = "conv:qq:group:a";
	for (let second = 0; second <= 110; second += 10) {
		at(second * 1000);
		expect(modes.push(conv, { id: String(second) })).toBeUndefined();
	}
	at(119_000);
	expect(modes.drain()).toEqual([]);
	at(120_000);
	const [batch] = modes.drain();
	expect(batch?.trigger).toBe("max-window");
	expect(batch?.messages).toHaveLength(12);
});

test("batch：关键消息立即出包，其余按 5 分钟窗口合并", () => {
	const { clock, at } = clockAt();
	const modes = new ListenModes({ clock, listen: listen({ mode: "batch" }) });
	const conv = "conv:qq:group:b";
	expect(modes.push(conv, { id: "1", text: "普通消息" })).toBeUndefined();
	at(299_999);
	expect(modes.drain()).toEqual([]);
	at(300_000);
	expect(modes.drain()).toEqual([{ conv, messages: [expect.objectContaining({ id: "1" })], trigger: "window" }]);
	at(310_000);
	expect(modes.push(conv, { id: "2", text: "看这个 https://example.com", link: true })?.trigger).toBe("key");
	expect(modes.push(conv, { id: "3", owner: true })?.trigger).toBe("key");
	expect(modes.push(conv, { id: "4", image: true })?.trigger).toBe("key");
	expect(modes.push(conv, { id: "5", text: "普通消息" })).toBeUndefined();
	expect(modes.pending(conv)).toBe(1);
});

test("mention：只看 @，非 @ 永不出包，@ 立即出包", () => {
	const { clock, at } = clockAt();
	const modes = new ListenModes({ clock, listen: listen({ mode: "mention" }) });
	const conv = "conv:qq:group:b";
	expect(modes.push(conv, { id: "1", text: "没 @" })).toBeUndefined();
	at(600_000);
	expect(modes.drain()).toEqual([]);
	expect(modes.pending(conv)).toBe(0);
	expect(modes.push(conv, { id: "2", text: "@bot 在吗", mentionsBot: true })).toEqual({
		conv,
		messages: [expect.objectContaining({ id: "2" })],
		trigger: "mention",
	});
});

test("digest：窗口内累计 5 条才判断，不足则到点丢弃", () => {
	const { clock, at } = clockAt();
	const modes = new ListenModes({ clock, listen: listen({ mode: "digest" }) });
	const conv = "conv:qq:group:b";
	for (const id of ["1", "2", "3", "4"]) {
		at(Number(id) * 1000);
		expect(modes.push(conv, { id })).toBeUndefined();
	}
	at(5_000);
	expect(modes.push(conv, { id: "5" })).toEqual({
		conv,
		messages: expect.arrayContaining([expect.objectContaining({ id: "5" })]),
		trigger: "digest",
	});
	at(10_000);
	expect(modes.push(conv, { id: "6" })).toBeUndefined();
	at(10_000 + 14 * 60_000);
	expect(modes.drain()).toEqual([]);
	expect(modes.pending(conv)).toBe(1);
	at(10_000 + 15 * 60_000);
	expect(modes.drain()).toEqual([]);
	expect(modes.pending(conv)).toBe(0);
});

test("逐群覆盖：同一引擎里两个群各按自己的模式出包", () => {
	const { clock, at } = clockAt();
	const modes = new ListenModes({ clock, listen: listen({ mode: "digest" }) });
	at(1_000);
	modes.push("conv:qq:group:a", { id: "1" });
	modes.push("conv:qq:group:b", { id: "2" });
	at(16_000);
	expect(modes.drain().map((batch) => [batch.conv, batch.trigger])).toEqual([["conv:qq:group:a", "quiet"]]);
	at(2_000 + 15 * 60_000);
	expect(modes.drain()).toEqual([]);
	expect(modes.pending("conv:qq:group:b")).toBe(0);
});
