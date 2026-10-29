import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { Actor, Card, Device } from "../api/types";
import type { CardFaceProps } from "../components/card/CardFace";
import { $session } from "../store";
import { entityRef } from "./entityRef";

/** 名片页的一行 / 一张卡：我的名片、我的 Agent（有无名片都有）、收到的名片。 */
export interface CardItem {
	/** 路由 id：有名片用名片 id，Agent 基础名片用 a~<actorId> */
	key: string;
	section: "mine" | "agent" | "recv";
	actor: Actor;
	card?: Card;
	mine: boolean;
}

export const cardUrl = (i: CardItem) =>
	`${location.origin}${i.actor.kind === "agent" || !i.card ? `/p/${entityRef(i.actor)}` : `/u/${entityRef(i.card)}`}`;
export { canShareCard } from "./cardSharing";
export const deviceLabel = (d: Pick<Device, "kind">) => (d.kind === "cloud" || d.kind === "server" ? "云端" : "本地");
export const itemName = (i: CardItem) =>
	i.section === "mine" && i.card?.kind === "persona" ? i.card.title : i.actor.name;
/** 草稿的 Agent 卡不上卡面，仍画基础名片 */
const shown = (i: CardItem) =>
	i.card && (i.section !== "agent" || i.card.status === "published") ? i.card : undefined;
export const itemSummary = (i: CardItem) => shown(i)?.summary ?? null;

export function faceProps(i: CardItem): CardFaceProps {
	const c = shown(i);
	const agent = i.actor.kind === "agent";
	return {
		name: i.actor.name,
		avatarUrl: i.actor.avatarUrl,
		agent,
		headline: c?.tagline ?? c?.summary ?? i.actor.summary,
		face: c?.face,
		display: c?.display,
		online: agent ? !!i.actor.online : undefined,
		badge: agent ? "Bot" : undefined,
	};
}

export function useCardItems() {
	const me = useStore($session)?.actor;
	const { data: cards = [], isLoading } = useQuery({ queryKey: ["cards"], queryFn: api.cards });
	const { data: contacts = [] } = useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
	const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: api.devices });
	const received = cards.filter((c) => !c.mine);
	const ids = [...new Set(received.map((c) => c.ownerId))].sort();
	const { data: owners = [] } = useQuery({
		queryKey: ["actors", "card-owners", ids.join(",")],
		queryFn: () => api.actors(ids),
		enabled: ids.length > 0,
	});
	const meActor: Actor = me ?? { id: "", kind: "human", name: "" };
	const defaultCard = cards.find((c) => c.mine && c.ownerId === meActor.id && c.kind === "default");
	const defaultItem: CardItem = {
		key: defaultCard?.id ?? `a~${meActor.id}`,
		section: "mine",
		actor: meActor,
		card: defaultCard,
		mine: true,
	};
	const personas: CardItem[] = cards
		.filter((c) => c.mine && c.ownerId === meActor.id && c.kind !== "default")
		.map((c) => ({ key: c.id, section: "mine", actor: meActor, card: c, mine: true }));
	const agents: CardItem[] = contacts
		.filter((a) => a.kind === "agent" && a.ownerId === meActor.id)
		.map((a) => {
			const card = cards.find((c) => c.mine && c.ownerId === a.id);
			return { key: card?.id ?? `a~${entityRef(a)}`, section: "agent", actor: a, card, mine: true };
		});
	const recv: CardItem[] = received
		.flatMap((c) => {
			const actor = owners.find((a) => a.id === c.ownerId);
			return actor ? [{ key: c.id, section: "recv" as const, actor, card: c, mine: false }] : [];
		})
		.sort((a, b) => a.actor.name.localeCompare(b.actor.name, "zh-Hans-u-co-pinyin"));
	const groups = devices.map((d) => ({ device: d, items: agents.filter((i) => i.actor.deviceId === d.id) }));
	const items = [defaultItem, ...personas, ...agents, ...recv];
	return { me: meActor, isLoading, defaultItem, personas, groups, devices, received: recv, items };
}

/** 本人默认卡、自有 Agent 与历史分身；无设备 Agent 也保留。 */
export function useWalletItems() {
	const data = useCardItems();
	return [data.defaultItem, ...data.items.filter((i) => i.section === "agent"), ...data.personas];
}
