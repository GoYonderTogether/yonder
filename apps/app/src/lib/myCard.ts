import type { Card } from "../api/types";

export interface MyCardForm {
	name: string;
	tagline: string;
	greeting: string;
}

/** 我自己的名片：优先注册时自动建好的默认名片，其次最新的个人名片；Agent 的名片不算。 */
export function pickMyCard(cards: Card[] | undefined, meId: string): Card | undefined {
	const own = (cards ?? []).filter((c) => c.mine && c.ownerId === meId);
	return own.find((c) => c.kind === "default") ?? own[0];
}

export function formFromCard(card: Card | undefined, name: string): MyCardForm {
	return { name, tagline: card?.tagline ?? "", greeting: card?.markdown ?? "" };
}

/** 保存草稿的入参：名字同时作名片标题；开场白放在名片正文，访客在名片页看到。 */
export function draftInput(form: MyCardForm) {
	return { title: form.name.trim(), tagline: form.tagline.trim(), markdown: form.greeting.trim() };
}

export const canSaveCard = (form: MyCardForm) => form.name.trim().length > 0 && form.name.trim().length <= 40;

/** 登录后回到「建我的名片」的落点；来源归因只有 share 令牌，没有就只带 next。 */
export function wantCardLogin(share?: string | null): string {
	const params = new URLSearchParams({ next: "/me?card=new" });
	if (share) params.set("share", share);
	return `/login?${params.toString()}`;
}
