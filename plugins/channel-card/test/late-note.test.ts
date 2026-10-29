import { describe, expect, it } from "vitest";
import { lateNote } from "../src/channel.js";

describe("补收旧消息标注（JV2-J03-10）", () => {
	const now = Date.parse("2026-10-29T21:00:37Z");
	it("超过 5 分钟的补收消息标明发送时间", () => {
		const text = lateNote(Date.parse("2026-10-29T20:25:01.495Z"), "起草名片 E2E 小店 r2", now);
		expect(text).toMatch(/^\[补收：这条消息发于 2026-10-29T20:25:01.495Z/);
		expect(text.endsWith("\n起草名片 E2E 小店 r2")).toBe(true);
	});
	it("刚断线的补收不加标注", () => {
		expect(lateNote(now - 60_000, "你好", now)).toBe("你好");
	});
});
