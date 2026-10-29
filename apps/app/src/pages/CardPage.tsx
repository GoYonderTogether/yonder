import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { selectAccount } from "../cache";
import { AppBar } from "../components/AppBar";
import { IdentityDetail } from "../components/IdentityDetail";
import { IdentityQr } from "../components/IdentityQr";
import { useStartChat } from "../lib/cardActions";
import { entityRef } from "../lib/entityRef";
import { useAppBack } from "../lib/navigation";
import { useEntityId } from "../lib/useEntityId";
import { $session } from "../store";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";

/** Public-only query and actions, also embedded as the add-friend result. */
export function PublicIdentity({
	accountId,
	cardId,
	source = "link",
}: {
	accountId?: string;
	cardId?: string;
	source?: "scan" | "link";
}) {
	const account = useEntityId("actor", accountId);
	const cardRef = useEntityId("card", cardId);
	const canonicalCardId = cardRef.id;
	const qc = useQueryClient();
	const session = useStore($session);
	const { busy: busyProfile, start } = useStartChat();
	const nav = useNavigate();
	const [starting, setStarting] = useState(false);
	const [adding, setAdding] = useState(false);
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
	const addFriend = async () => {
		if (!session || session.actor.anonymous) {
			toast("注册后可加好友，聊天无需注册");
			return;
		}
		setAdding(true);
		try {
			await api.addFriend(actor.ownerId ?? actor.id);
			void qc.invalidateQueries({ queryKey: ["contacts"] });
			toast("已添加朋友");
		} catch (error) {
			toast(error instanceof Error ? error.message : "添加失败", true);
		} finally {
			setAdding(false);
		}
	};
	return (
		<IdentityDetail
			actor={actor}
			card={card ?? profile.card}
			summary={profile.summary}
			agents={profile.agents}
			owner={profile.owner}
			publicView
			qr={
				<IdentityQr
					actor={actor}
					cardId={card?.status === "published" ? card.id : profile.card?.id}
					card={card?.status === "published" ? card : profile.card}
				/>
			}
			actions={
				<div className="flex flex-wrap gap-2">
					{!self && (
						<Button variant="primary" className="h-11" disabled={busyProfile || starting} onClick={hi}>
							开始聊天
						</Button>
					)}
					{!self && !ownedAgent && (
						<Button className="h-11" disabled={adding} onClick={addFriend}>
							加好友
						</Button>
					)}
				</div>
			}
		/>
	);
}

/** Compatible public URLs remain view-only until an explicit action. */
export function CardPage() {
	const { id, accountId } = useParams();
	const [params] = useSearchParams();
	const back = useAppBack("/");
	return (
		<div className="flex h-dvh flex-col bg-ground">
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
			<div className="scroll-y min-h-0 flex-1">
				<PublicIdentity accountId={accountId} cardId={id} source={params.get("s") === "scan" ? "scan" : "link"} />
			</div>
		</div>
	);
}
