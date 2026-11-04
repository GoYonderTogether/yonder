import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { selectAccount } from "../cache";
import { AppBar } from "../components/AppBar";
import { PaperCard, PaperIntro } from "../components/card/PaperCard";
import { useStartChat } from "../lib/cardActions";
import { appPath } from "../lib/base";
import { entityRef } from "../lib/entityRef";
import { wantCardLogin } from "../lib/myCard";
import { useAppBack } from "../lib/navigation";
import { useEntityId } from "../lib/useEntityId";
import { useShareUrl } from "../lib/useShareUrl";
import { $session } from "../store";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { AddFriendButton } from "./Friends";

/**
 * Public-only query and actions, also embedded as the add-friend result.
 * 页面就是原型的那张纸卡：正面信息，点按翻背面；卡外是「和我的 AI 聊聊」与「详情」。
 */
export function PublicIdentity({
	accountId,
	cardId,
	source = "link",
	share,
}: {
	accountId?: string;
	cardId?: string;
	source?: "scan" | "link";
	/** 访客是通过哪条分享链接来的；带去登录页做拉新归因 */
	share?: string | null;
}) {
	const account = useEntityId("actor", accountId);
	const cardRef = useEntityId("card", cardId);
	const canonicalCardId = cardRef.id;
	const qc = useQueryClient();
	const session = useStore($session);
	const { busy: busyProfile, start } = useStartChat();
	const nav = useNavigate();
	const [starting, setStarting] = useState(false);
	const [collecting, setCollecting] = useState(false);
	const member = !!session && !session.actor.anonymous;
	const myCards = useQuery({ queryKey: ["cards"], queryFn: api.cards, enabled: member && !!cardId });
	const cardQuery = useQuery({
		queryKey: ["card", canonicalCardId],
		enabled: !!canonicalCardId,
		queryFn: () => api.card(canonicalCardId!),
	});
	const actorId = account.id ?? cardQuery.data?.ownerId;
	const profileQuery = useQuery({
		queryKey: ["profile", actorId],
		enabled: !!actorId,
		queryFn: () => api.profile(actorId!),
	});
	const profile = profileQuery.data;
	const actor = profile?.actor;
	const card = cardId ? cardQuery.data : undefined;
	// 公开地址要带部署 base（IdentityQr 同款）；自己的名片升级为服务端分享链接（拉新归因）。
	const plainUrl = card
		? `${location.origin}${appPath(`/u/${entityRef(card)}`)}`
		: `${location.origin}${appPath(location.pathname + location.search)}`;
	const shareUrl = useShareUrl(
		card?.status === "published" && card.mine
			? { kind: "card", targetId: card.id, path: plainUrl.slice(location.origin.length) }
			: undefined,
		plainUrl,
		true,
	);
	if (
		account.pending ||
		cardRef.pending ||
		session === undefined ||
		(canonicalCardId && cardQuery.isPending) ||
		(actorId && profileQuery.isPending)
	)
		return (
			<p role="status" className="p-6 text-small text-muted">
				正在加载资料…
			</p>
		);
	if (account.error || cardRef.error)
		return (
			<div role="alert" className="p-6">
				<p>加载资料失败</p>
				<Button
					onClick={() => {
						void account.retry();
						void cardRef.retry();
					}}
				>
					重试
				</Button>
			</div>
		);
	if (cardQuery.isError || profileQuery.isError)
		return (
			<div role="alert" className="flex flex-col items-start gap-3 p-6">
				<p>加载资料失败</p>
				<Button
					onClick={() => {
						if (cardId) void cardQuery.refetch();
						if (actorId) void profileQuery.refetch();
					}}
				>
					重试
				</Button>
			</div>
		);
	if (!actor || (cardId && !card))
		return (
			<p role="status" className="p-6 text-muted">
				这个资料不存在或无法访问
			</p>
		);
	const self = actor.id === session?.actor.id;
	const ownedAgent = actor.kind === "agent" && actor.ownerId === session?.actor.id;
	const face = (card ?? profile.card)?.face;
	const profile_ = face?.profile;
	const hi = async () => {
		if (self) return;
		if (!card) {
			void start(actor.id);
			return;
		}
		setStarting(true);
		try {
			if (!session) {
				const anonymous = await api.createAnonymous();
				selectAccount(anonymous.actor.id, qc);
				$session.set(anonymous);
			}
			const conv = await api.startFromCard(card.id, source);
			for (const key of ["convs", "cards", "contacts"]) void qc.invalidateQueries({ queryKey: [key] });
			nav(`/c/${entityRef(conv)}`);
		} catch (error) {
			toast(error instanceof Error ? error.message : "无法开始聊天", true);
		} finally {
			setStarting(false);
		}
	};
	const collected = !!card && !!myCards.data?.some((c) => c.id === card.id && !c.mine);
	const collect = async () => {
		if (!card) return;
		setCollecting(true);
		try {
			await api.collectCard(card.id, source);
			await qc.invalidateQueries({ queryKey: ["cards"] });
			toast("已收藏，可在「我 → 收藏的名片」查看");
		} catch (error) {
			toast(error instanceof Error ? error.message : "收藏失败", true);
		} finally {
			setCollecting(false);
		}
	};
	const chatLabel = profile_?.alias?.trim() ? `和 ${profile_.alias.trim()} 的 AI 聊聊` : "和我的 AI 聊聊";
	return (
		<div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 py-5">
			<PaperCard
				name={actor.name}
				photoUrl={face?.coverUrl ?? actor.avatarUrl}
				profile={profile_}
				headline={card?.tagline ?? profile.card?.tagline ?? actor.summary ?? undefined}
				tags={face?.tags ?? []}
				url={shareUrl}
			/>			{!self && (
				<Button variant="primary" className="h-12" disabled={busyProfile || starting} onClick={hi}>
					<span className="inline-block size-[7px] rounded-full bg-online" aria-hidden />
					{chatLabel}
				</Button>
			)}
			{!self && !ownedAgent && (
				<AddFriendButton key={actor.ownerId ?? actor.id} accountId={actor.ownerId ?? actor.id} />
			)}
			{!self && !ownedAgent && member && card && (
				<Button className="h-11" disabled={collecting || collected} onClick={collect}>
					{collected ? "已收藏" : "收藏"}
				</Button>
			)}
			<PaperIntro profile={profile_} />
			{profile_?.intro?.trim() && !self && (
				<p className="text-center text-small text-faint">扫码看详情，或直接和上面的 AI 聊聊</p>
			)}
			{!self && (
				<Link
					to={!session || session.actor.anonymous ? wantCardLogin(share) : "/me?card=new"}
					className="press self-center rounded-full px-4 py-2 text-small text-muted underline underline-offset-4 hover:text-ink"
				>
					我也要一张
				</Link>
			)}
		</div>
	);
}

/** Compatible public URLs remain view-only until an explicit action. */
export function CardPage() {
	const { id, accountId } = useParams();
	const [params] = useSearchParams();
	const back = useAppBack("/");
	return (
		<div className="app-frame flex flex-col bg-rail">
			<AppBar
				title="名片"
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
			<div className="scroll-y min-h-0 flex-1">
				<PublicIdentity
					accountId={accountId}
					cardId={id}
					source={params.get("s") === "scan" ? "scan" : "link"}
					share={params.get("share")}
				/>
			</div>
		</div>
	);
}
