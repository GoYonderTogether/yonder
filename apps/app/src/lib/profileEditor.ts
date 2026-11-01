import { isAvatarUrl } from "../api/avatarUrl";
import type { Actor, Card, CardFace, CardVisibility, ProfileUpdateInput } from "../api/types";

export const cardVisibility = (face?: CardFace): CardVisibility => ({
	signature: true,
	code: true,
	greeting: true,
	...face?.visibility,
	shop: face?.visibility?.shop !== false,
});

/** Explicit profile preferences never fall back to an older face headline or summary. */
export function identityHeadline(
	card?: Pick<Card, "face" | "tagline" | "summary"> | null,
	...fallbacks: (string | null | undefined)[]
) {
	if (!cardVisibility(card?.face).signature) return undefined;
	if (card?.face?.visibility) return card.tagline?.trim() || undefined;
	return [card?.face?.headline, card?.tagline, card?.summary, ...fallbacks].find((line) => line?.trim())?.trim();
}

export function profileForm(actor: Actor, card?: Card): ProfileUpdateInput {
	return {
		name: actor.name,
		avatarUrl: isAvatarUrl(actor.avatarUrl) ? actor.avatarUrl : null,
		tagline: card?.tagline ?? "",
		markdown: card?.markdown ?? "",
		coverUrl: isAvatarUrl(card?.face?.coverUrl) ? card.face.coverUrl : null,
		visibility: cardVisibility(card?.face),
	};
}

export function profileTextError(form: Pick<ProfileUpdateInput, "name" | "tagline">): string | undefined {
	if (/\p{Cc}/u.test(form.name)) return "昵称不能包含换行或控制字符";
	const name = [...form.name.trim()].length;
	if (!name || name > 40) return "昵称需要 1–40 个字";
	if ([...form.tagline.trim()].length > 120) return "个性签名最多 120 个字";
}

export function profileError(form: ProfileUpdateInput): string | undefined {
	const textError = profileTextError(form);
	if (textError) return textError;
	if ([...form.markdown].length > 2000) return "访客开场白最多 2000 个字";
	if ([form.avatarUrl, form.coverUrl].some((url) => url !== null && (!isAvatarUrl(url) || url.length > 2048)))
		return "图片地址无效，请重新选择图片";
}

export function profileSaveError(error: unknown): string {
	const status = (error as { status?: number } | null)?.status;
	if (status === 401) return "登录已失效，资料尚未保存，请重新登录后重试";
	if (status === 400) return "资料不符合要求，请检查填写内容";
	if (status === 404) return "资料服务尚不可用，请稍后重试";
	if (status === 503) return "资料服务暂不可用，请稍后重试";
	return error instanceof Error ? error.message : "保存失败，请重试";
}

/** Personal signatures use the canonical text field, including an explicit empty value. */
export function humanSignature(card?: Pick<Card, "face" | "tagline"> | null): string | undefined {
	return cardVisibility(card?.face).signature ? card?.tagline?.trim() || undefined : undefined;
}
