import { afterEach, expect, it, vi } from "vitest";
import { httpApi } from "../src/api/http";
import type { ProfileUpdateInput } from "../src/api/types";
import { CardShareDialog } from "../src/components/CardShare";
import { renderCardImage } from "../src/components/card/image";
import { identityHeadline, profileSaveError } from "../src/lib/profileEditor";

const form: ProfileUpdateInput = {
	name: "名字",
	avatarUrl: null,
	tagline: "签名",
	markdown: "开场白",
	coverUrl: null,
	visibility: { signature: true, code: true, greeting: true },
};
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
it("uses one real PUT for the complete profile and retains its errors without clearing the draft session", async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify({ actor: { id: "a" }, card: { id: "c" } }), { status: 200 }));
	const dispatch = vi.fn();
	vi.stubGlobal("fetch", fetcher);
	vi.stubGlobal("window", { dispatchEvent: dispatch });
	await httpApi.saveProfile(form);
	const [url, init] = fetcher.mock.calls[0];
	expect(url).toMatch(/\/api\/me\/profile$/);
	expect(init.method).toBe("PUT");
	expect(JSON.parse(init.body)).toEqual(form);
	for (const status of [401, 404]) {
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: "save_failed" }), { status }));
		await expect(httpApi.saveProfile(form)).rejects.toMatchObject({ status, message: "save_failed" });
	}
	expect(dispatch).not.toHaveBeenCalled();
	fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }));
	await expect(httpApi.contacts()).rejects.toMatchObject({ status: 401 });
	expect(dispatch).toHaveBeenCalledOnce();
});
it("keeps a configured visible signature through the card-stack QR adapter", () => {
	vi.stubGlobal("location", { origin: "https://yonderbot.net" });
	const actor = { id: "me", kind: "human" as const, name: "昵称", summary: "旧摘要" };
	const card = {
		id: "c",
		code: "ABC123",
		mine: false,
		ownerId: "me",
		respondentId: "me",
		kind: "default" as const,
		title: "我的名片",
		summary: null,
		tagline: "当前签名",
		markdown: "",
		status: "published" as const,
		rev: 1,
		updatedAt: 1,
		face: { theme: "mist" as const, headline: "旧签名", visibility: form.visibility },
	};
	const result = CardShareDialog({
		item: { key: card.id, section: "recv", actor, card, mine: false },
		open: false,
		onOpenChange() {},
	});
	expect(identityHeadline(result.props.card, actor.summary)).toBe("当前签名");
});
it("saved QR images omit hidden signatures while preserving the real name", async () => {
	const text = vi.fn();
	const noop = () => {};
	const context = {
		beginPath: noop,
		roundRect: noop,
		clip: noop,
		fillRect: noop,
		fill: noop,
		fillText: text,
		measureText: (value: string) => ({ width: value.length * 2 }),
		save: noop,
		restore: noop,
		drawImage: noop,
	};
	vi.stubGlobal("document", {
		fonts: { ready: Promise.resolve() },
		documentElement: {},
		createElement: () => ({ getContext: () => context, toDataURL: () => "data:image/png;base64,test" }),
	});
	vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "sans-serif" }));
	await renderCardImage({
		name: "实际名字",
		headline: "隐藏签名",
		face: { theme: "mist", coverUrl: null, visibility: { signature: false, code: false, greeting: false } },
		qr: {} as HTMLCanvasElement,
	});
	expect(text.mock.calls.map((call) => call[0])).toContain("实际名字");
	expect(text.mock.calls.map((call) => call[0])).not.toContain("隐藏签名");
});

it("explains known save failures without hiding actual network errors", () => {
	for (const [status, text] of [
		[401, "登录已失效"],
		[400, "资料不符合要求"],
		[404, "资料服务尚不可用"],
		[503, "资料服务暂不可用"],
	] as const)
		expect(profileSaveError(Object.assign(new Error("code"), { status }))).toContain(text);
	expect(profileSaveError(new Error("网络已断开"))).toBe("网络已断开");
});
