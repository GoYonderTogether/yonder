import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { AppBar } from "../components/AppBar";
import { ListingCard } from "../components/market/ListingCard";
import { ListingDetail } from "../components/market/ListingDetail";
import { MarketDialog } from "../components/market/MarketUI";
import { SellerWorkspace } from "../components/market/SellerWorkspace";
import { PublishDialog } from "../components/market/SellPanel";
import { entityRef } from "../lib/entityRef";
import { internalState, useAppBack } from "../lib/navigation";
import { identityHeadline } from "../lib/profileEditor";
import { useEntityId } from "../lib/useEntityId";
import { listingInput, marketError, type ShopTab } from "../market/listingPolicy";
import { useListingFeed, useListingLookup } from "../market/queries";
import { useMarketState } from "../market/store";
import type { Listing } from "../market/types";
import { $session } from "../store";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import "../market/market.css";

export function Shop() {
	const session = useStore($session);
	const location = useLocation();
	const { accountId } = useParams();
	const ownRoute = location.pathname === "/me/shop";
	const resolved = useEntityId("actor", accountId);
	const id = ownRoute ? session?.actor.id : resolved.id;
	if (ownRoute && (session === null || session?.actor.anonymous))
		return <Navigate to="/login" state={{ next: "/me/shop" }} replace />;
	return (
		<ShopContent
			key={`${session?.actor.id ?? "guest"}:${id ?? accountId}`}
			id={id}
			owner={!!session && !session.actor.anonymous && session.actor.id === id}
			pending={session === undefined || resolved.pending}
			resolveError={!!resolved.error}
			retryResolve={() => void resolved.retry()}
		/>
	);
}
function ShopContent({
	id,
	owner,
	pending,
	resolveError,
	retryResolve,
}: {
	id?: string;
	owner: boolean;
	pending: boolean;
	resolveError: boolean;
	retryResolve: () => void;
}) {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const location = useLocation();
	const personalBack = useAppBack("/me");
	const publicBack = useAppBack(id ? `/p/${id}` : "/market");
	const [params, setParams] = useSearchParams();
	const { state, setState, storageKey } = useMarketState();
	const profile = useQuery({
		queryKey: ["profile", id],
		queryFn: () => {
			if (!id) throw new Error("账号尚未解析");
			return api.profile(id);
		},
		enabled: !!id && !pending,
	});
	const tab: ShopTab = ["paused", "expired"].includes(params.get("status") ?? "")
		? (params.get("status") as ShopTab)
		: "active";
	const feed = useListingFeed(owner ? { mine: true, status: tab } : { sellerId: id }, !!id && !pending);
	const lookup = useListingLookup([params.get("item"), params.get("edit")].filter((value): value is string => !!value));
	const referenced = [...feed.items, ...lookup.items];
	const editing = owner ? referenced.find((item) => item.id === params.get("edit") && item.mine) : undefined;
	const detail = referenced.find((item) => item.id === params.get("item"));
	const [stats, setStats] = useState<Listing | null>(null);
	const panel = params.get("panel");
	const close = () => {
		if (location.state?.shopOverlay) {
			navigate(-1);
			return;
		}
		const next = new URLSearchParams(params);
		["panel", "item", "edit"].forEach((key) => {
			next.delete(key);
		});
		setParams(next, { replace: true, state: location.state });
	};
	const open = (panel: string, item?: Listing) => {
		const next = new URLSearchParams(params);
		["item", "edit"].forEach((key) => {
			next.delete(key);
		});
		next.set("panel", panel);
		if (item) next.set(panel === "publish" ? "edit" : "item", item.id);
		setParams(next, { state: { ...location.state, shopOverlay: true } });
	};
	const changed = async () => {
		await qc.invalidateQueries({ queryKey: ["market-listings"] });
	};
	const save = async (listing: Listing) => {
		if (!owner || $session.get()?.actor.id !== id) {
			toast("当前账号已变化，请重新打开小店。", true);
			return false;
		}
		try {
			const input = listingInput(listing, editing);
			if (editing) {
				const { kind: _, ...patch } = input;
				await api.updateListing(editing.id, patch);
			} else await api.createListing(input);
			await changed();
			close();
			toast(editing ? "修改已保存" : "已发布");
			return true;
		} catch (error) {
			toast(marketError(error), true);
			return false;
		}
	};
	const toggle = (key: "saved" | "liked", listing: Listing) => {
		const current = $session.get();
		if (!current || current.actor.anonymous) {
			navigate("/login", { state: { next: location.pathname + location.search } });
			return;
		}
		setState((old) => ({
			...old,
			[key]: old[key].includes(listing.id) ? old[key].filter((id) => id !== listing.id) : [...old[key], listing.id],
		}));
	};
	const actor = profile.data?.actor;
	const unavailable = !pending && !resolveError && !id;
	return (
		<div className="mk-app flex-col">
			<AppBar
				title={owner ? "我的小店" : "小店"}
				left={
					<Button
						type="button"
						size="icon"
						variant="ghost"
						aria-label={owner ? "返回我的" : "返回资料"}
						onClick={owner ? personalBack : publicBack}
					>
						<ArrowLeft size={20} />
					</Button>
				}
				right={
					owner && (
						<Button
							type="button"
							className="bg-highlight text-on-highlight hover:bg-highlight/90"
							onClick={() => open("publish")}
						>
							<Plus size={17} />
							发布
						</Button>
					)
				}
			/>
			<main className="scroll-y min-h-0 flex-1 px-4 pb-16">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
					{actor && (
						<section className="flex items-center gap-3 rounded-card bg-raised p-5">
							<Avatar actor={actor} size={52} />
							<div className="min-w-0 flex-1">
								<h1 className="truncate text-title font-semibold">{actor.name}的小店</h1>
								{identityHeadline(profile.data?.card, actor.summary) && (
									<p className="mt-1 break-words text-small text-muted">
										{identityHeadline(profile.data?.card, actor.summary)}
									</p>
								)}
							</div>
							{!owner && (
								<Link
									to={`/p/${entityRef(actor)}`}
									state={internalState(location)}
									className="text-small text-accent-ink"
								>
									个人主页
								</Link>
							)}
						</section>
					)}
					{(pending || (profile.isPending && !!id)) && (
						<p role="status" className="py-10 text-center text-muted">
							正在加载小店…
						</p>
					)}
					{(resolveError || profile.isError || unavailable || (id && profile.isSuccess && !actor)) && (
						<div role="alert" className="flex flex-col items-start gap-3 py-8">
							<p>{unavailable || (profile.isSuccess && !actor) ? "这个小店不存在或无法访问" : "小店加载失败"}</p>
							{!unavailable && (
								<Button
									onClick={() => {
										if (resolveError) retryResolve();
										else if (id) void profile.refetch();
									}}
								>
									重试
								</Button>
							)}
						</div>
					)}
					{actor && (
						<>
							{owner ? (
								<SellerWorkspace
									listings={feed.items}
									tab={tab}
									onTab={(status) => setParams({ status }, { replace: true, state: location.state })}
									onEdit={(item) => open("publish", item)}
									onOpen={(item) => open("detail", item)}
									onStats={setStats}
									loading={feed.isPending}
									error={feed.isError}
									onToggle={async (itemId) => {
										const item = feed.items.find((item) => item.id === itemId);
										if (!item) throw new Error("发布不存在，请刷新");
										await api.setListingPaused(itemId, !item.paused);
										await changed();
									}}
									onDelete={async (itemId) => {
										await api.deleteListing(itemId);
										await changed();
									}}
								/>
							) : (
								<div className="mk-feed-grid">
									{feed.items.map((item) => (
										<ListingCard
											key={item.id}
											listing={item}
											saved={state.saved.includes(item.id)}
											liked={state.liked.includes(item.id)}
											onOpen={() => open("detail", item)}
											onSave={() => toggle("saved", item)}
											onLike={() => toggle("liked", item)}
										/>
									))}
								</div>
							)}
							{feed.isPending && (
								<p role="status" className="py-8 text-center text-muted">
									正在加载发布…
								</p>
							)}
							{feed.isError && (
								<div role="alert" className="flex flex-col items-center gap-3 py-8">
									<p>发布加载失败</p>
									<p className="text-small text-muted">{marketError(feed.error)}</p>
									<Button onClick={() => void feed.refetch()}>重试</Button>
								</div>
							)}
							{!owner && feed.isSuccess && !feed.items.length && (
								<p className="py-12 text-center text-muted">暂时没有可浏览的发布</p>
							)}
							{feed.hasNextPage && (
								<Button disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
									{feed.isFetchingNextPage ? "加载中…" : "加载更多"}
								</Button>
							)}
							{!!feed.items.length && (
								<p className="text-caption text-muted">
									已加载 {feed.items.length} 条{feed.hasNextPage ? "，还有更多" : ""}
								</p>
							)}
						</>
					)}
				</div>
			</main>
			<PublishDialog
				open={owner && panel === "publish" && (!params.get("edit") || !!editing)}
				close={close}
				editing={editing}
				storageKey={storageKey}
				onPublish={save}
			/>
			<ListingDetail
				listing={panel === "detail" ? (detail ?? null) : null}
				liked={!!detail && state.liked.includes(detail.id)}
				saved={!!detail && state.saved.includes(detail.id)}
				compared={false}
				canCompare={false}
				onCompare={() => {}}
				close={close}
				onSave={() => detail && toggle("saved", detail)}
				onLike={() => detail && toggle("liked", detail)}
				onEdit={(item) => {
					const next = new URLSearchParams(params);
					next.delete("item");
					next.set("edit", item.id);
					next.set("panel", "publish");
					setParams(next, { replace: true, state: location.state });
				}}
				onInquiry={(item) =>
					navigate(
						$session.get() && !$session.get()?.actor.anonymous
							? `/market?panel=assist&item=${encodeURIComponent(item.id)}`
							: "/login",
						{ state: { next: `/market?panel=assist&item=${encodeURIComponent(item.id)}` } },
					)
				}
			/>
			{panel && (params.get("edit") || params.get("item")) && !editing && !detail && (
				<MarketDialog open close={close} title="发布">
					{lookup.isPending ? (
						<p className="mk-dialog-body" role="status">
							正在加载发布…
						</p>
					) : (
						<div className="mk-dialog-body" role="alert">
							<p>{lookup.isError ? "加载发布失败" : "发布不存在或当前不可访问"}</p>
							{lookup.isError && <Button onClick={() => void lookup.refetch()}>重试</Button>}
						</div>
					)}
				</MarketDialog>
			)}
			<MarketDialog open={!!stats} close={() => setStats(null)} title="发布数据">
				<div className="mk-dialog-body">
					<h2>{stats?.title}</h2>
					<dl className="mk-stats-grid">
						{stats &&
							[
								{ name: "Bot 浏览", value: stats.metrics.agentViews },
								{ name: "用户浏览", value: stats.metrics.humanViews },
								{ name: "加入候选", value: stats.metrics.shortlists },
								{ name: "收到咨询", value: stats.metrics.inquiries },
							].map((row) => (
								<div key={row.name}>
									<dt>{row.name}</dt>
									<dd>{row.value.toLocaleString()}</dd>
								</div>
							))}
					</dl>
				</div>
			</MarketDialog>
		</div>
	);
}
