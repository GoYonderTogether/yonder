import type { CardItem } from "./cardItems";

/** 发布过不等于允许公开；草稿字段不能进入二维码图片或公开链接。 */
export const canShareCard = (i: Pick<CardItem, "actor" | "card">) =>
	(i.actor.kind !== "agent" || i.actor.public === true) && (!i.card || i.card.status === "published");
