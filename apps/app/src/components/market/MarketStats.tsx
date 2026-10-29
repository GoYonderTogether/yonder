import { ArrowUpRight, Bookmark, ChevronRight, Eye, Heart, Package, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { compactCount, viewCount } from "../../market/catalog";
import { useMarketState } from "../../market/store";
import type { Listing } from "../../market/types";

/** Personal market entries belong to the shared Me page, not the public feed. */
export function MyMarket() {
	const { state } = useMarketState();
	const mine = state.listings.filter((l) => l.mine);
	// 示例数据不当真实浏览数展示（UX-04）；有真实数据的发布才显示这一行
	const real = mine.filter((l) => l.metricSource !== "sample");
	return (
		<section aria-label="我的市场" className="overflow-hidden rounded-card bg-raised">
			<div className="grid grid-cols-4 gap-1 px-2 py-5">
				{[
					{ route: "posts", title: "发布", count: mine.length, icon: Package },
					{ route: "saved", title: "收藏", count: state.saved.length, icon: Bookmark },
					{ route: "liked", title: "点赞", count: state.liked.length, icon: Heart },
					{ route: "needs", title: "需求", count: state.tasks.length, icon: Sparkles },
				].map(({ route, title, count, icon: Icon }) => (
					<Link
						key={route}
						to={"/me/market/" + route}
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
			{real.length > 0 && (
				<Link
					to="/me/market/stats"
					className="press flex min-h-14 items-center gap-3 border-t border-hairline px-5 hover:bg-tone"
				>
					<Eye size={19} className="text-muted" />
					<span className="flex-1 text-small">浏览数据</span>
					<span className="text-small text-muted">
						{compactCount(real.reduce((n, l) => n + viewCount(l), 0))} 次浏览
					</span>
					<ChevronRight size={15} className="text-faint" />
				</Link>
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
				<span>发布累计浏览</span>
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
						<img src={l.image} alt="" />
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
			<p className="mk-form-hint">
				当前预览未连接曝光统计服务。
				{mine.some((l) => l.metricSource === "sample")
					? "示例帖的数据用于展示；你新发布的帖子从 0 开始。"
					: "暂无真实浏览记录。"}
				浏览次数不等于独立买家人数。
			</p>
		</section>
	);
}
