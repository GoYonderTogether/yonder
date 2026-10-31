import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../../api";
import type { Actor } from "../../api/types";
import { deviceLabel, useCardItems } from "../../lib/cardItems";
import { entityRef } from "../../lib/entityRef";
import { useAppBack } from "../../lib/navigation";
import { $session } from "../../store";
import { Button } from "../../ui/Button";
import { toast } from "../../ui/Toast";
import { AgentPublicToggle } from "../AgentPublicToggle";
import { AppBar } from "../AppBar";
import { IdentityDetail } from "../IdentityDetail";
import { IdentityQr } from "../IdentityQr";
import { Switch } from "./DeviceSheet";

const SOURCE = { scan: "扫码", link: "链接", chat: "聊天" } as const;

function ago(at: number) {
	const days = Math.floor((Date.now() - at) / 86400_000);
	if (days < 1) return Math.max(1, Math.floor((Date.now() - at) / 3600_000)) + " 小时前";
	return days < 30 ? `${days} 天前` : new Date(at).toLocaleDateString();
}

/** 开关某个 Agent 的联网（乐观更新）。 */
export function useAgentOnline() {
	const qc = useQueryClient();
	return async (a: Actor, v: boolean) => {
		const previous = qc.getQueryData<Actor[]>(["contacts"]);
		qc.setQueryData<Actor[]>(["contacts"], (items) =>
			items?.map((item) => (item.id === a.id ? { ...item, online: v } : item)),
		);
		try {
			const updated = await api.setAgentOnline(a.id, v);
			qc.setQueryData<Actor[]>(["contacts"], (items) => items?.map((item) => (item.id === a.id ? updated : item)));
			qc.setQueriesData<Actor[]>({ queryKey: ["actors"] }, (items) =>
				items?.map((item) => (item.id === a.id ? updated : item)),
			);
			toast(v ? `${a.name} 已联网` : `${a.name} 已断开联网`);
		} catch (error) {
			qc.setQueryData(["contacts"], previous);
			toast(error instanceof Error ? error.message : "更新失败", true);
		}
	};
}

/** Internal identity adapter: only this wrapper adds relationship and owner controls. */
export function ContactDetail({ a, desktop, embedded = false }: { a: Actor; desktop: boolean; embedded?: boolean }) {
	const nav = useNavigate();
	const back = useAppBack("/contacts");
	const [params] = useSearchParams();
	const data = useCardItems();
	const setOnline = useAgentOnline();
	const [busy, setBusy] = useState(false);
	const agent = a.kind === "agent";
	const self = a.id === data.me.id;
	const mine = agent && a.ownerId === data.me.id;
	const { data: profile } = useQuery({
		queryKey: ["profile", a.id],
		queryFn: () => api.profile(a.id),
		enabled: !a.anonymous,
	});
	const item = data.items.find(
		(i) =>
			i.actor.id === a.id &&
			(!params.get("card") || i.card?.id === params.get("card") || i.card?.code === params.get("card")),
	);
	const card = item?.card ?? profile?.card;
	const shareCard = item?.card?.status === "published" ? item.card : profile?.card;
	const device = mine ? data.devices.find((d) => d.id === a.deviceId) : undefined;
	const rows = [
		a.note && ["备注", a.note],
		item?.card &&
			!item.card.mine &&
			item.card.source && [
				"来源",
				[SOURCE[item.card.source], item.card.collectedAt && ago(item.card.collectedAt)].filter(Boolean).join(" · "),
			],
		device && ["所在设备", `${device.name} · ${deviceLabel(device)} · ${device.online ? "在线" : "离线"}`],
	].filter(Boolean) as [string, string][];
	const message = async () => {
		setBusy(true);
		try {
			const conv = await api.openDm(a.id);
			nav(`/c/${entityRef(conv)}`);
		} catch (error) {
			toast(error instanceof Error ? error.message : "无法打开会话", true);
			setBusy(false);
		}
	};
	const body = (
		<IdentityDetail
			actor={a}
			card={card}
			summary={profile?.summary}
			agents={
				self && embedded
					? []
					: self
						? data.items.filter((i) => i.section === "agent").map((i) => i.actor)
						: profile?.agents
			}
			owner={profile?.owner}
			qr={
				<IdentityQr
					actor={a}
					cardId={shareCard?.id}
					card={shareCard}
					mine={item?.card?.id === shareCard?.id && item?.card?.mine}
				/>
			}
			actions={
				!self && (
					<Button variant="primary" className="h-11 self-start" disabled={busy} onClick={message}>
						<MessageCircle size={16} />
						发消息
					</Button>
				)
			}
		>
			{(!!rows.length || mine) && (
				<dl className="flex flex-col divide-y divide-hairline/60 rounded-card bg-tone px-4">
					{rows.map(([k, v]) => (
						<div key={k} className="flex gap-4 py-3 text-small">
							<dt className="w-16 shrink-0 text-muted">{k}</dt>
							<dd className="min-w-0 flex-1 break-words">{v}</dd>
						</div>
					))}
					{mine && (
						<div className="flex items-center justify-between py-3 text-small">
							<dt className="text-muted">联网</dt>
							<dd>
								<Switch on={!!a.online} onChange={(v) => setOnline(a, v)} label={`${a.name} 联网`} />
							</dd>
						</div>
					)}
				</dl>
			)}
			{mine && <AgentPublicToggle actor={a} />}
		</IdentityDetail>
	);
	if (embedded) return body;
	return (
		<div className="flex h-full flex-col bg-ground">
			<AppBar
				title="资料"
				left={
					<button
						type="button"
						onClick={back}
						aria-label="返回"
						className="press -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-tone"
					>
						<ArrowLeft size={20} />
					</button>
				}
			/>
			<div className="scroll-y min-h-0 flex-1">{body}</div>
		</div>
	);
}

export function SelfIdentity() {
	const me = useStore($session)?.actor;
	return me ? <ContactDetail a={me} desktop={false} embedded /> : null;
}
