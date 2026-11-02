import { ArrowUpRight, Bookmark, ChevronRight, Eye, Heart, Sparkles, Store } from "lucide-react";
import { Link, useLocation } from "react-router";
import { internalState } from "../../lib/navigation";
import { compactCount, hasListingImage, viewCount } from "../../market/catalog";
import { useListingFeed, useListingLookup } from "../../market/queries";
import { useMarketState } from "../../market/store";
import type { Listing } from "../../market/types";
import { useWatchTasks } from "../../market/watch";

/** Personal market entries belong to the shared Me page, not the public feed. */
export function MyMarket() {
	const location = useLocation();
	const { state } = useMarketState();
	const needs = useWatchTasks();
	const feed = useListingFeed({ mine: true });
	const lookup = useListingLookup([...state.saved, ...state.liked]);
	const savedCount = state.saved.filter((id) => !lookup.missing.includes(id)).length;
	const likedCount = state.liked.filter((id) => !lookup.missing.includes(id)).length;
	const staleSaved = state.saved.filter((id) => lookup.missing.includes(id)).length;
	const real = feed.items.filter((listing) => listing.metricSource !== "sample");
	return (
		<section aria-label="我的市场" className="overflow-hidden rounded-card bg-raised">
			<Link to="/me/shop" state={internalState(location)} className="press block px-5 py-4 hover:bg-tone">
				<div className="flex items-center gap-3">
					<Store size={21} className="text-muted" />
					<span className="flex-1 font-medium">我的小店</span>
					<ChevronRight size={17} className="text-faint" />
				</div>
				{feed.isPending ? (
					<p className="mt-3 text-caption text-muted">正在加载发布…</p>
				) : feed.isError ? (
					<p className="mt-3 text-caption text-muted">发布暂时无法加载，进入小店重试</p>
				) : (
					<>
						<div className="mt-3 flex items-center gap-2">
							{feed.items
								.slice(0, 3)
								.filter((listing) => hasListingImage(listing.image))
								.map((listing) => (
									<img key={listing.id} src={listing.image} alt="" className="size-14 rounded-control object-cover" />
								))}
							<span className="text-caption text-muted">
								{feed.items.length
									? `已加载 ${feed.items.length} 条发布${feed.hasNextPage ? "，还有更多" : ""}`
									: "还没有发布"}
							</span>
						</div>
						{real.length > 0 && (
							<p className="mt-2 text-caption text-muted">
								{compactCount(real.reduce((total, listing) => total + viewCount(listing), 0))} 次浏览
								{feed.hasNextPage ? "（已加载）" : ""}
							</p>
						)}
					</>
				)}
			</Link>
			<div className="grid grid-cols-3 border-t border-hairline/60 px-2 py-3">
				{[
					{ route: "saved", title: "收藏", count: savedCount, icon: Bookmark },
					{ route: "liked", title: "点赞", count: likedCount, icon: Heart },
					{ route: "needs", title: "需求", count: needs.data?.length ?? 0, icon: Sparkles },
				].map(({ route, title, count, icon: Icon }) => (
					<Link
						key={route}
						to={"/me/market/" + route}
						state={internalState(location)}
						aria-label={"我的" + title}
						className="press flex flex-col items-center gap-2 rounded-control py-2 hover:bg-tone"
					>
						<Icon size={20} strokeWidth={1.6} />
						<span className="text-small">
							{title}
							<span className="ml-1.5 text-caption text-muted">{count}</span>
						</span>
					</Link>
				))}
			</div>
			{staleSaved > 0 && (
				<p className="px-5 pb-3 text-caption text-muted">
					有 {staleSaved} 条收藏已失效（帖子已下架或删除），不再计入。
				</p>
			)}
		</section>
	);
}

export function MarketStats({ listings, onStats }: { listings: Listing[]; onStats: (listing: Listing) => void }) {
	const mine = listings.filter((l) => l.mine);
	const totals = mine.reduce(
		(n, l) => ({
			agent: n.agent + l.metrics.agentViews,
			human: n.human + l.metrics.humanViews,
			shortlisted: n.shortlisted + l.metrics.shortlists,
			inquiries: n.inquiries + l.metrics.inquiries,
		}),
		{ agent: 0, human: 0, shortlisted: 0, inquiries: 0 },
	);
	return (
		<section className="mk-narrow mk-exposure">
			<div className="mk-exposure-total">
				<span>已加载发布浏览</span>
				<strong>{(totals.agent + totals.human).toLocaleString()}</strong>
				<p>包含 Bot 发现与用户浏览</p>
			</div>
			<div className="mk-stats-grid">
				{[
					{ label: "Bot 浏览", value: totals.agent },
					{ label: "用户浏览", value: totals.human },
					{ label: "加入候选", value: totals.shortlisted },
					{ label: "收到咨询", value: totals.inquiries },
				].map((m) => (
					<div key={m.label}>
						<strong>{m.value.toLocaleString()}</strong>
						<span>{m.label}</span>
					</div>
				))}
			</div>
			<div className="mk-exposure-posts">
				{mine.map((l) => (
					<button type="button" key={l.id} onClick={() => onStats(l)}>
						{hasListingImage(l.image) && <img src={l.image} alt="" />}
						<span>
							<strong>{l.title}</strong>
							<small>
								{l.paused ? "已下架 · " : ""}
								{compactCount(viewCount(l))} 次浏览
							</small>
						</span>
						<ArrowUpRight size={18} />
					</button>
				))}
			</div>
			{!mine.length && (
				<div className="mk-empty">
					<Eye size={30} />
					<h3>发布后，在这里看见反馈</h3>
					<Link className="mk-button" to="/market?panel=publish">
						发布第一篇
					</Link>
				</div>
			)}
		</section>
	);
}
