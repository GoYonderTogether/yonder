import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import type { Actor, Card } from "../src/api/types";
import { CardShare } from "../src/components/CardShare";
import { CardFaceView } from "../src/components/card/CardFace";
import { IdentityDetail } from "../src/components/IdentityDetail";
import { type CardItem, faceProps, itemSummary } from "../src/lib/cardItems";

const actor: Actor = { id: "human", kind: "human", name: "本人", summary: "旧账号摘要" };
const card: Card = {
	id: "card",
	kind: "default",
	ownerId: "human",
	respondentId: "human",
	title: "本人",
	mine: true,
	markdown: "",
	summary: "旧摘要",
	tagline: "新签名",
	face: { theme: "mist", headline: "旧卡面标题" },
	status: "published",
	rev: 1,
	updatedAt: 1,
};
it("human profile, card and QR use the signature field without replacing old face data", () => {
	const item: CardItem = { key: card.id, section: "mine", actor, card, mine: true };
	const profile = renderToStaticMarkup(
		<MemoryRouter>
			<IdentityDetail actor={actor} card={card} />
		</MemoryRouter>,
	);
	const face = renderToStaticMarkup(<CardFaceView {...faceProps(item)} />);
	const qr = renderToStaticMarkup(<CardShare actor={actor} card={card} url="https://yonderbot.net/p/human" />);
	for (const html of [profile, face, qr]) {
		expect(html).toContain("新签名");
		expect(html).not.toContain("旧卡面标题");
		expect(html).not.toContain("旧摘要");
	}
	expect(itemSummary(item)).toBe("新签名");
	expect(card.face?.headline).toBe("旧卡面标题");
});
it("clearing a human signature never revives the legacy face or account summary", () => {
	const empty = { ...card, tagline: null };
	const item: CardItem = { key: card.id, section: "mine", actor, card: empty, mine: true };
	const profile = renderToStaticMarkup(
		<MemoryRouter>
			<IdentityDetail actor={actor} card={empty} />
		</MemoryRouter>,
	);
	const face = renderToStaticMarkup(<CardFaceView {...faceProps(item)} />);
	const qr = renderToStaticMarkup(<CardShare actor={actor} card={empty} url="https://yonderbot.net/p/human" />);
	for (const html of [profile, face, qr])
		for (const old of ["旧卡面标题", "旧摘要", "旧账号摘要"]) expect(html).not.toContain(old);
	expect(itemSummary(item)).toBeNull();
});
it("Bot cards retain their legacy face headline priority", () => {
	const bot: Actor = { ...actor, id: "bot", kind: "agent", public: true };
	const item: CardItem = { key: card.id, section: "agent", actor: bot, card, mine: true };
	const face = renderToStaticMarkup(<CardFaceView {...faceProps(item)} />);
	const profile = renderToStaticMarkup(
		<MemoryRouter>
			<IdentityDetail actor={bot} card={card} />
		</MemoryRouter>,
	);
	expect(face).toContain("旧卡面标题");
	expect(profile).toContain("旧卡面标题");
});
