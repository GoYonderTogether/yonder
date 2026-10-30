import { ArrowRight, ChartNoAxesColumn, Heart, Package, Pencil } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { compactCount, hasListingImage, kindLabel, priceLabel, viewCount } from "../../market/catalog";
import type { Listing } from "../../market/types";
import { ListingCard } from "./ListingCard";
import { MarketDialog } from "./MarketUI";

export function SellerWorkspace({
	listings,
	saved,
	tab,
	onTab,
	onEdit,
	onToggle,
	onOpen,
	onSave,
	onStats,
	onBrowse,
}: {
	listings: Listing[];
	saved: string[];
	tab: string;
	onTab: (tab: string) => void;
	onEdit: (l: Listing) => void;
	onToggle: (id: string) => void;
	onOpen: (l: Listing) => void;
	onSave: (id: string) => void;
	onStats: (l: Listing) => void;
	onBrowse: () => void;
}) {
	const [confirmPause, setConfirmPause] = useState<Listing | null>(null);
	const mine = listings.filter((l) => l.mine);
	const items =
		tab === "saved"
			? listings.filter((l) => saved.includes(l.id))
			: mine.filter((l) => (tab === "paused" ? l.paused : !l.paused));
	return (
		<section className="mk-workspace mk-narrow">
			<div className="mk-personal-tabs">
				{[
					{ id: "published", label: "已发布", count: mine.filter((l) => !l.paused).length },
					{ id: "paused", label: "已下架", count: mine.filter((l) => l.paused).length },
				].map((t) => (
					<button
						type="button"
						key={t.id}
						aria-pressed={tab === t.id}
						className={cn(tab === t.id && "is-active")}
						onClick={() => onTab(t.id)}
					>
						{t.label}
						<span>{t.count}</span>
					</button>
				))}
			</div>
			{tab === "saved" ? (
				<div className="mk-feed-grid mk-saved-grid">
					{items.map((l) => (
						<div key={l.id}>
							<ListingCard listing={l} saved onOpen={() => onOpen(l)} onSave={() => onSave(l.id)} />
							{l.paused && <p className="mk-form-hint">已下架</p>}
						</div>
					))}
				</div>
			) : (
				<div className="mk-my-listings">
					{items.map((l) => (
						<article key={l.id}>
							<button
								type="button"
								className="mk-my-listing-image"
								aria-label={`查看${l.title}`}
								onClick={() => onOpen(l)}
							>
								{hasListingImage(l.image) && <img src={l.image} alt="" />}
							</button>
							<div className="mk-my-listing-info">
								<button type="button" onClick={() => onOpen(l)}>
									{l.title}
								</button>
								<p className="mk-price">{priceLabel(l)}</p>
								<p className="mk-muted">
									{kindLabel(l.kind)} · {l.location} · {compactCount(viewCount(l))} 浏览
								</p>
							</div>
							<div className="mk-my-listing-actions">
								<button type="button" className="mk-button" onClick={() => onStats(l)}>
									<ChartNoAxesColumn size={16} />
									数据
								</button>
								<button type="button" className="mk-button" onClick={() => onEdit(l)}>
									<Pencil size={15} />
									编辑
								</button>
								<button
									type="button"
									className="mk-button"
									onClick={() => (l.paused ? onToggle(l.id) : setConfirmPause(l))}
								>
									{l.paused ? "重新上架" : "下架"}
								</button>
							</div>
						</article>
					))}
				</div>
			)}
			{!items.length && (
				<div className="mk-empty">
					{tab === "saved" ? <Heart size={32} /> : <Package size={32} />}
					<h3>{tab === "saved" ? "喜欢的，先留下来" : tab === "paused" ? "没有下架的发布" : "还没有发布"}</h3>
					<p>
						{tab === "saved"
							? "收藏好物和服务，之后在这里继续看。"
							: "点击右上角「发布」，分享物品、服务、创意或机会。"}
					</p>
					{tab === "saved" && (
						<button type="button" className="mk-button" onClick={onBrowse}>
							去市场看看
							<ArrowRight size={16} />
						</button>
					)}
				</div>
			)}
			<MarketDialog open={!!confirmPause} close={() => setConfirmPause(null)} title="确认下架？">
				<div className="mk-dialog-body">
					<p>{confirmPause?.title}</p>
					<div className="mk-my-listing-actions">
						<button type="button" className="mk-button" onClick={() => setConfirmPause(null)}>
							取消
						</button>
						<button
							type="button"
							className="mk-button mk-primary"
							onClick={() => {
								if (confirmPause) onToggle(confirmPause.id);
								setConfirmPause(null);
							}}
						>
							确认下架
						</button>
					</div>
				</div>
			</MarketDialog>
		</section>
	);
}
