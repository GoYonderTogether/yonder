import { expect, it, vi } from "vitest";
import type { Actor, Card } from "../src/api/types";
import { saveLegacyProfile } from "../src/lib/legacyProfile";
import { humanSignature } from "../src/lib/profileEditor";

const actor: Actor = { id: "self", name: "昵称", kind: "human" };
const card: Card = {
	id: "card",
	ownerId: actor.id,
	respondentId: actor.id,
	kind: "default",
	mine: true,
	title: "原有卡名",
	tagline: "旧签名",
	summary: null,
	markdown: "保留正文",
	status: "published",
	rev: 1,
	updatedAt: 1,
	face: { theme: "ink", headline: "原卡面标题" },
	display: { kind: "svg", source: "<svg/>" },
};
it("retries publication of only this form's acknowledged draft after a publish failure", async () => {
	const draft: Card = { ...card, tagline: "新签名", status: "draft", rev: 2, updatedAt: 2 };
	const published: Card = { ...draft, status: "published" };
	const api = {
		updateProfile: vi.fn(),
		saveDraft: vi.fn().mockResolvedValue(draft),
		publish: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(published),
	};
	let pendingDraft: Card | undefined;
	const callbacks = {
		active: () => true,
		onActor: vi.fn(),
		onCard: (value: Card) => {
			pendingDraft = value;
		},
	};
	await expect(saveLegacyProfile(api, actor, card, { name: actor.name, tagline: "新签名" }, callbacks)).rejects.toThrow(
		"签名草稿已保存，发布尚未确认",
	);
	expect(pendingDraft).toBe(draft);
	const result = await saveLegacyProfile(
		api,
		actor,
		draft,
		{ name: actor.name, tagline: "新签名" },
		{ ...callbacks, pendingDraft },
	);
	expect(result.card).toBe(published);
	expect(api.publish).toHaveBeenCalledTimes(2);
	expect(api.saveDraft).toHaveBeenCalledOnce();
	expect(api.saveDraft).toHaveBeenCalledWith(card.id, {
		title: card.title,
		tagline: "新签名",
		markdown: card.markdown,
		face: card.face,
		display: card.display,
	});
	expect(card.face?.headline).toBe("原卡面标题");
});
it("refuses to publish a draft changed after the partial-write receipt", async () => {
	const pendingDraft: Card = { ...card, tagline: "新签名", status: "draft", rev: 2, updatedAt: 2 };
	const changed: Card = { ...pendingDraft, rev: 3, updatedAt: 3, markdown: "别的未发布修改" };
	const api = { updateProfile: vi.fn(), saveDraft: vi.fn(), publish: vi.fn() };
	await expect(
		saveLegacyProfile(
			api,
			actor,
			changed,
			{ name: "新昵称", tagline: "新签名" },
			{ active: () => true, onActor: vi.fn(), onCard: vi.fn(), pendingDraft },
		),
	).rejects.toThrow("未发布或已变化的草稿");
	for (const method of Object.values(api)) expect(method).not.toHaveBeenCalled();
});
it("human signature clearing never exposes old card headlines or summaries", () => {
	for (const tagline of [null, "", "   "]) expect(humanSignature({ face: card.face, tagline })).toBeUndefined();
	expect(humanSignature({ face: card.face, tagline: " 新签名 " })).toBe("新签名");
	expect(card.face?.headline).toBe("原卡面标题");
});
