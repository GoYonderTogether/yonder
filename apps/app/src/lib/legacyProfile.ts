import type { ApiClient } from "../api/client";
import type { Actor, Card, ProfileUpdateInput, ProfileUpdateResult } from "../api/types";
import { profileSaveError, profileTextError } from "./profileEditor";

/** Old services have no transaction: acknowledge real writes and never publish unrelated drafts. */
export async function saveLegacyProfile(
	client: Pick<ApiClient, "updateProfile" | "saveDraft" | "publish">,
	actor: Actor,
	card: Card | undefined,
	form: Pick<ProfileUpdateInput, "name" | "tagline"> & { face?: ProfileUpdateInput["face"] },
	callbacks: { active(): boolean; onActor(actor: Actor): void; onCard(card: Card): void; pendingDraft?: Card },
): Promise<ProfileUpdateResult> {
	const invalid = profileTextError(form);
	if (invalid) throw new Error(invalid);
	if (!card) throw new Error("未找到默认名片，请刷新后重试");
	const name = form.name.trim(),
		tagline = form.tagline.trim();
	const signatureChanged = tagline !== (card.tagline ?? "").trim();
	const pending = callbacks.pendingDraft;
	const ownDraft =
		card.status === "draft" &&
		pending?.id === card.id &&
		pending.rev === card.rev &&
		pending.updatedAt === card.updatedAt;
	if (card.status !== "published" && (signatureChanged || pending) && !ownDraft)
		throw new Error("名片有未发布或已变化的草稿，暂时无法修改个性签名");
	let actualActor = actor;
	let attempted = false;
	const acknowledged: string[] = [];
	const active = () => {
		if (!callbacks.active()) throw new Error("账号已变化，请重新打开个人资料");
	};
	try {
		active();
		if (name !== actor.name) {
			attempted = true;
			actualActor = await client.updateProfile({ name });
			if (actualActor.id !== actor.id) throw new Error("账号已变化，请重新打开个人资料");
			acknowledged.push("昵称已保存");
			callbacks.onActor(actualActor);
			active();
		}
		if (!signatureChanged && !ownDraft) return { actor: actualActor, card };
		active();
		attempted = true;
		const draft =
			ownDraft && !signatureChanged && !form.face
				? card
				: await client.saveDraft(card.id, {
						title: card.title,
						tagline,
						markdown: card.markdown,
						display: card.display,
						face: { theme: card.face?.theme ?? "mist", ...card.face, ...(form.face ?? {}) },
					});
		acknowledged.push("签名草稿已保存，发布尚未确认");
		callbacks.onCard(draft);
		active();
		const published = await client.publish(card.id);
		active();
		return { actor: actualActor, card: published };
	} catch (failure) {
		if (!attempted) throw failure;
		const details = acknowledged.length ? `（${acknowledged.join("；")}）` : "";
		throw new Error(`部分修改可能已保存，请重试${details}。${profileSaveError(failure)}`, { cause: failure });
	}
}
