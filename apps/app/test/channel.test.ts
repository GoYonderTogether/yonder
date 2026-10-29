import { MessageSquare, Monitor } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../src/work/api/types";
import { ChannelIcon, channelGlyph } from "../src/work/features/messages/ChannelIcon";
import { applyMessage, channelName, channelType, fromTranscript, splitTurn } from "../src/work/lib/chat";

const CHANNELS = [
	["cli", "终端"],
	["card", "名片"],
	["wechat", "微信"],
	["wechat-ilink", "微信"],
	["qq", "QQ"],
	["feishu", "飞书"],
	["github", "GitHub"],
	["mcp", "外部 AI"],
	["agent", "Bot"],
	["cron", "定时"],
	["pi", "pi"],
] as const;

/** 网关消息项在 T-API-19 之后可能带 channel/fromName；用真实形状而不是另造类型。 */
const withMeta = (item: TranscriptItem, meta: { channel?: string; fromName?: string }) =>
	({ ...item, ...meta }) as unknown as TranscriptItem;

describe("channelType / channelName", () => {
	it("names every covered channel", () => {
		for (const [channel, name] of CHANNELS) {
			expect(channelType(channel)).toBe(channel);
			expect(channelName(channel)).toBe(name);
		}
	});
	it("maps channel instances to their type", () => {
		expect(channelType("qq-main")).toBe("qq");
		expect(channelType("feishu-main")).toBe("feishu");
		expect(channelType("github-work")).toBe("github");
		expect(channelName("qq-main")).toBe("QQ");
	});
	it("keeps the console default and unknown values as they are", () => {
		expect(channelType(undefined)).toBeUndefined();
		expect(channelName(undefined)).toBe("控制台");
		expect(channelName("console")).toBe("控制台");
		expect(channelType("matrix")).toBe("matrix");
		expect(channelName("matrix")).toBe("matrix");
	});
});

describe("fromTranscript channel metadata", () => {
	it("keeps the console default when the item carries no channel", () => {
		// 真实形状：yonder.message 的用户输入是原文，没有 <turn> 包装，也没有 channel 字段。
		const [item] = fromTranscript([{ id: 7, kind: "yonder.message", text: "你好" }]);
		expect(item).toMatchObject({ role: "user", text: "你好" });
		expect(item?.channel).toBeUndefined();
		expect(channelName(item?.channel)).toBe("控制台");
	});
	it("uses the channel and fromName a gateway sends with the item", () => {
		const [item] = fromTranscript([
			withMeta({ id: 8, kind: "yonder.message", text: "在吗" }, { channel: "feishu", fromName: "阿明" }),
		]);
		expect(item).toMatchObject({ role: "user", text: "在吗", channel: "feishu", fromName: "阿明" });
	});
	it("still reads a <turn channel> wrapper", () => {
		const [item] = fromTranscript([
			{ id: 9, kind: "pi.user", text: '<turn id="e1" channel="qq-main">\n你好\n</turn>\n正文' },
		]);
		expect(item).toMatchObject({ role: "user", text: "正文", channel: "qq-main" });
		expect(channelName(item?.channel)).toBe("QQ");
	});
	it("does not infer a channel from an account ref on its own", () => {
		// 渠道归一是内核的事（T-API-19 parseChannel）；消息项没有 channel 就显示控制台。
		const [item] = fromTranscript([{ id: 10, kind: "yonder.message", text: "群消息", from: "acct:qq:10001" }]);
		expect(item?.channel).toBeUndefined();
		expect(channelName(item?.channel)).toBe("控制台");
	});
	it("does not turn a notification into a user bubble", () => {
		const [item] = fromTranscript([{ id: 11, kind: "yonder.notification", text: "提醒", from: "acct:qq:1" }]);
		expect(item?.role).toBe("notice");
	});
	it("leaves splitTurn untouched for plain text", () => {
		expect(splitTurn("普通文本")).toEqual({ body: "普通文本" });
	});
	it("keeps channel metadata on a live streamed user message", () => {
		const [item] = applyMessage([], "live:1", {
			role: "user",
			content: [{ type: "text", text: "实时消息" }],
			channel: "wechat",
			fromName: "阿明",
		});
		expect(item).toMatchObject({ role: "user", text: "实时消息", channel: "wechat", fromName: "阿明" });
	});
	it("adds no channel to a live user message that has none", () => {
		const [item] = applyMessage([], "live:2", { role: "user", content: "本地输入" });
		expect(item).toMatchObject({ role: "user", text: "本地输入" });
		expect(item?.channel).toBeUndefined();
		expect(item?.fromName).toBeUndefined();
	});
});

describe("ChannelIcon", () => {
	it("gives every covered channel its own glyph", () => {
		const glyphs = CHANNELS.map(([channel]) => channelGlyph(channel));
		// 微信与 wechat-ilink 是同一产品的两种接入，共用字形；其余各不相同。
		expect(new Set(glyphs).size).toBe(CHANNELS.length - 1);
		expect(channelGlyph("wechat-ilink")).toBe(channelGlyph("wechat"));
		for (const [channel] of CHANNELS) expect(channelGlyph(channel)).not.toBe(channelGlyph("matrix"));
	});
	it("uses a neutral glyph for unknown channels and the console glyph without one", () => {
		expect(channelGlyph("matrix")).toBe(MessageSquare);
		expect(channelGlyph(undefined)).toBe(Monitor);
		expect(channelGlyph("console")).toBe(Monitor);
	});
	it("renders a colour block svg with the normalised channel", () => {
		const html = renderToStaticMarkup(createElement(ChannelIcon, { channel: "qq-main" }));
		expect(html).toContain('data-testid="channel-icon"');
		expect(html).toContain('data-channel="qq"');
		expect(html).toContain("<svg");
		expect(html).not.toContain("<img");
	});
});
