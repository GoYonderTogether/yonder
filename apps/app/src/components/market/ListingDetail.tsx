import { ArrowRight, Bookmark, Check, Eye, Heart, MessageCircle, Pencil, Plus, X } from "lucide-react";
import { kindLabel, priceLabel, viewCount } from "../../market/catalog";
import type { Listing, Match } from "../../market/types";
import { MarketDialog, SellerAvatar } from "./MarketUI";

export function ListingDetail({
	listing,
	match,
	liked,
	onLike,
	saved,
	compared,
	close,
	onSave,
	onCompare,
	onInquiry,
	onEdit,
}: {
	listing: Listing | null;
	match?: Match;
	liked: boolean;
	onLike: () => void;
	saved: boolean;
	compared: boolean;
	close: () => void;
	onSave: () => void;
	onCompare: () => void;
	onInquiry: (listing: Listing) => void;
	onEdit: (listing: Listing) => void;
}) {
	return (
		<MarketDialog
			open={!!listing}
			close={close}
			title={listing ? kindLabel(listing.kind) + "详情" : "帖子详情"}
			wide
			className="mk-detail-dialog"
		>
			{listing && (
				<>
					<div className="mk-detail-layout">
						<div className="mk-detail-photo">
							<img src={listing.image} alt={listing.title} style={{ objectPosition: listing.imagePosition }} />
							{!listing.mine && <span>示意图片</span>}
						</div>
						<div className="mk-detail-content">
							<p className="mk-muted">
								{listing.category} · {listing.location}
								{listing.paused && " · 已下架"}
							</p>
							<h2>{listing.title}</h2>
							<p className="mk-price mk-detail-price">{priceLabel(listing)}</p>
							<p className="mk-detail-views">
								<Eye size={14} />
								{viewCount(listing).toLocaleString()} 次浏览{listing.metricSource === "sample" && <span>示例数据</span>}
							</p>
							<div className="mk-detail-seller">
								<SellerAvatar name={listing.seller} />
								<div>
									<strong>{listing.seller}</strong>
									<p>{listing.sellerRole}</p>
								</div>
							</div>
							<p className="mk-description">{listing.description}</p>
							<dl className="mk-facts">
								{listing.facts.map((f) => (
									<div key={f.label}>
										<dt>{f.label}</dt>
										<dd>{f.value}</dd>
									</div>
								))}
								<div>
									<dt>交付方式</dt>
									<dd>{listing.delivery}</dd>
								</div>
							</dl>
							{match && (
								<details className="mk-disclosure">
									<summary>为什么推荐给我 · {match.score}% 条件匹配</summary>
									{match.reasons.map((r) => (
										<p key={r}>{r}</p>
									))}
								</details>
							)}
							{!!listing.missing.length && (
								<details className="mk-disclosure">
									<summary>还需要确认的细节</summary>
									{listing.missing.map((m) => (
										<p key={m}>{m}</p>
									))}
								</details>
							)}
						</div>
					</div>
					<footer className="mk-detail-footer">
						<button
							type="button"
							className="mk-icon-button"
							aria-label={liked ? "取消点赞" : "点赞"}
							aria-pressed={liked}
							onClick={onLike}
						>
							<Heart size={21} fill={liked ? "currentColor" : "none"} />
						</button>
						<button
							type="button"
							className="mk-icon-button"
							aria-label={saved ? "取消收藏" : "收藏"}
							aria-pressed={saved}
							onClick={onSave}
						>
							<Bookmark size={21} fill={saved ? "currentColor" : "none"} />
						</button>
						{!listing.mine && (
							<button type="button" className="mk-button" onClick={onCompare} aria-pressed={compared}>
								{compared ? <Check size={17} /> : <Plus size={17} />}
								{compared ? "已选对比" : "加入对比"}
							</button>
						)}
						{listing.mine ? (
							<button type="button" className="mk-button mk-primary" onClick={() => onEdit(listing)}>
								<Pencil size={17} />
								编辑发布
							</button>
						) : (
							<button
								type="button"
								className="mk-button mk-primary"
								disabled={listing.paused}
								onClick={() => onInquiry(listing)}
							>
								<MessageCircle size={17} />
								{listing.paused ? "已下架" : "请 Bot 帮我看看"}
							</button>
						)}
					</footer>
				</>
			)}
		</MarketDialog>
	);
}
export function CompareDialog({
	listings,
	matches,
	close,
	onRemove,
	onInquiry,
}: {
	listings: Listing[];
	matches: Match[];
	close: () => void;
	onRemove: (id: string) => void;
	onInquiry: (listing: Listing) => void;
}) {
	const rows: { label: string; value: (l: Listing) => string }[] = [
		{ label: "价格", value: (l) => priceLabel(l) },
		{ label: "城市", value: (l) => l.location },
		{ label: "规格与服务", value: (l) => l.facts.map((f) => `${f.label}：${f.value}`).join("\n") },
		{ label: "交付", value: (l) => l.delivery },
		...(matches.length
			? [
					{
						label: "符合需求",
						value: (l: Listing) =>
							matches
								.find((m) => m.listing.id === l.id)
								?.reasons.slice(1)
								.join("；") ?? "未匹配当前需求",
					},
				]
			: []),
		{ label: "待确认", value: (l) => l.missing.join("；") || "具体交付时间" },
	];
	return (
		<MarketDialog open close={close} title="对比选择" wide>
			<div className="mk-dialog-body">
				<p className="mk-form-hint">
					{listings.length < 2 ? "再加入一件，就可以比较差异。" : "左右滑动，按同一维度比较。"}
				</p>
				{listings.length > 0 && (
					<div className="mk-table-scroll">
						<table className="mk-compare-table">
							<thead>
								<tr>
									<th>对比项</th>
									{listings.map((l) => (
										<th key={l.id}>
											<button
												type="button"
												className="mk-icon-button"
												aria-label={`移除${l.title}`}
												onClick={() => onRemove(l.id)}
											>
												<X size={16} />
											</button>
											<img src={l.image} alt="" />
											<strong>{l.title}</strong>
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={row.label}>
										<th scope="row">{row.label}</th>
										{listings.map((l) => (
											<td key={l.id}>{row.value(l)}</td>
										))}
									</tr>
								))}
								<tr>
									<th scope="row">下一步</th>
									{listings.map((l) => (
										<td key={l.id}>
											<button
												type="button"
												className="mk-button mk-primary"
												disabled={l.paused || l.mine}
												onClick={() => onInquiry(l)}
											>
												请 Bot 帮我看看
												<ArrowRight size={15} />
											</button>
										</td>
									))}
								</tr>
							</tbody>
						</table>
					</div>
				)}
				{listings.length === 0 && (
					<div className="mk-empty">
						<p>对比清单已清空</p>
						<button type="button" className="mk-button" onClick={close}>
							继续浏览
						</button>
					</div>
				)}
			</div>
		</MarketDialog>
	);
}
