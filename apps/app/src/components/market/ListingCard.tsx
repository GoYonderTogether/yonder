import { Bookmark, Eye, Heart } from "lucide-react";
import { Link, useLocation } from "react-router";
import { internalState } from "../../lib/navigation";
import { compactCount, hasListingImage, kindLabel, priceLabel, viewCount } from "../../market/catalog";
import { isExpired, locationLabel } from "../../market/listingPolicy";
import type { Listing } from "../../market/types";
import { SellerAvatar } from "./MarketUI";

export function ListingCard({
	listing,
	saved,
	liked,
	onOpen,
	onSave,
	onLike,
}: {
	listing: Listing;
	saved: boolean;
	liked?: boolean;
	onOpen: () => void;
	onSave: () => void;
	onLike?: () => void;
}) {
	const location = useLocation();
	return (
		<article className="mk-listing">
			<div className="mk-listing-visual">
				<button type="button" className="mk-photo-button" onClick={onOpen} aria-label={`查看${listing.title}`}>
					{hasListingImage(listing.image) && (
						<img src={listing.image} alt="" loading="lazy" style={{ objectPosition: listing.imagePosition }} />
					)}
				</button>
				{listing.kind !== "item" && <span className="mk-kind-badge">{kindLabel(listing.kind)}</span>}
				{!onLike && (
					<button
						type="button"
						className="mk-save-button"
						aria-label={`${saved ? "取消收藏" : "收藏"}${listing.title}`}
						aria-pressed={saved}
						onClick={onSave}
					>
						<Bookmark size={18} fill={saved ? "currentColor" : "none"} />
					</button>
				)}
			</div>
			<div className="mk-listing-body">
				<button type="button" className="mk-listing-title" onClick={onOpen}>
					{listing.title}
				</button>
				<div className="mk-price-row">
					<p className="mk-price mk-card-price">{priceLabel(listing)}</p>
					<span className="mk-muted">{locationLabel(listing)}</span>
				</div>
				<div className="mk-seller-row">
					<SellerAvatar name={listing.seller} />
					{listing.sellerId ? (
						<Link to={`/shop/${encodeURIComponent(listing.sellerId)}`} state={internalState(location)}>
							{listing.seller}
						</Link>
					) : (
						<span>{listing.seller}</span>
					)}
				</div>
				<div className="mk-card-meta">
					<span title={listing.metricSource === "sample" ? "示例浏览量，包含 Bot 与用户浏览" : "Bot 与用户浏览合计"}>
						<Eye size={13} />
						{compactCount(viewCount(listing))} 浏览
					</span>
					{onLike && (
						<button
							type="button"
							aria-label={`${liked ? "取消点赞" : "点赞"}${listing.title}`}
							aria-pressed={!!liked}
							onClick={onLike}
						>
							<Heart size={16} fill={liked ? "currentColor" : "none"} />
						</button>
					)}
				</div>
				{(listing.paused || isExpired(listing)) && (
					<p className="mk-form-hint">{listing.paused ? "已隐藏" : "已到期"}</p>
				)}
			</div>
		</article>
	);
}
