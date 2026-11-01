import { ChartNoAxesColumn, Ellipsis, Package, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { compactCount, hasListingImage, kindLabel, priceLabel, viewCount } from "../../market/catalog";
import { isExpired, listingTab, locationLabel, marketError, VISIBILITY_LABEL } from "../../market/listingPolicy";
import type { Listing } from "../../market/types";
import { MarketDialog } from "./MarketUI";

export function SellerWorkspace({
	listings,
	tab,
	onTab,
	onEdit,
	onToggle,
	onOpen,
	onStats,
	onDelete,
	loading = false,
	error = false,
	hasMore = false,
}: {
	listings: Listing[];
	saved?: string[];
	tab: string;
	onTab: (tab: string) => void;
	onEdit: (l: Listing) => void;
	onToggle: (id: string) => void | Promise<void>;
	onOpen: (l: Listing) => void;
	onSave?: (id: string) => void;
	onStats: (l: Listing) => void;
	onBrowse?: () => void;
	onDelete?: (id: string) => Promise<void>;
	loading?: boolean;
	error?: boolean;
	hasMore?: boolean;
}) {
	const [confirmation, setConfirmation] = useState<{ listing: Listing; action: "pause" | "delete" } | null>(null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const selectedTab = tab === "paused" || tab === "expired" ? "paused" : "active";
	const items = listings.filter((l) => l.mine && listingTab(l) === selectedTab);
	const perform = async (run: () => void | Promise<void>) => {
		if (busy) return;
		setBusy(true);
		setFailure("");
		try {
			await run();
			setConfirmation(null);
		} catch (error) {
			setFailure(marketError(error));
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="mk-workspace" aria-label="小店发布管理">
			<div className="mk-personal-tabs">
				{[
					{ id: "active", label: "在售" },
					{ id: "paused", label: "已隐藏" },
				].map((t) => (
					<button
						type="button"
						key={t.id}
						disabled={busy}
						aria-pressed={selectedTab === t.id}
						className={cn(selectedTab === t.id && "is-active")}
						onClick={() => onTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</div>
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
								{kindLabel(l.kind)} · {locationLabel(l)} · {compactCount(viewCount(l))} 浏览
							</p>
							<p className="mk-muted">
								{VISIBILITY_LABEL[l.visibility ?? "public"]}
								{isExpired(l)
									? ` · 已到期（${new Date(l.expiresAt ?? 0).toLocaleDateString()}）`
									: l.expiresAt
										? ` · ${new Date(l.expiresAt).toLocaleDateString()} 到期`
										: ""}
							</p>
						</div>
						<details className="relative shrink-0">
							<summary
								aria-label={`管理${l.title}`}
								className="press grid size-10 cursor-pointer list-none place-items-center rounded-full hover:bg-tone"
							>
								<Ellipsis size={20} />
							</summary>
							<div className="absolute right-0 z-20 flex min-w-36 flex-col gap-1 rounded-control border border-hairline bg-raised p-1 shadow-float">
								<button type="button" disabled={busy} className="mk-button justify-start" onClick={() => onStats(l)}>
									<ChartNoAxesColumn size={16} />
									数据
								</button>
								<button type="button" disabled={busy} className="mk-button justify-start" onClick={() => onEdit(l)}>
									<Pencil size={15} />
									编辑
								</button>
								<button
									type="button"
									disabled={busy}
									className="mk-button justify-start"
									onClick={() => {
										if (isExpired(l)) onEdit(l);
										else if (l.paused) void perform(() => onToggle(l.id));
										else {
											setFailure("");
											setConfirmation({ listing: l, action: "pause" });
										}
									}}
								>
									{isExpired(l) ? "续期" : l.paused ? "重新上架" : "下架"}
								</button>
								{onDelete && (
									<button
										type="button"
										disabled={busy}
										className="mk-button justify-start text-danger"
										onClick={() => {
											setFailure("");
											setConfirmation({ listing: l, action: "delete" });
										}}
									>
										<Trash2 size={15} />
										删除
									</button>
								)}
							</div>
						</details>
					</article>
				))}
			</div>
			{!items.length && !loading && !error && (
				<div className="mk-empty">
					<Package size={30} />
					<h3>
						{hasMore
							? "已加载的发布中暂无此类内容，可继续加载"
							: selectedTab === "paused"
								? "没有隐藏的发布"
								: "还没有在售发布"}
					</h3>
				</div>
			)}
			{failure && !confirmation && (
				<p role="alert" className="mk-error">
					{failure}
				</p>
			)}
			<MarketDialog
				open={!!confirmation}
				close={() => !busy && setConfirmation(null)}
				title={confirmation?.action === "delete" ? "删除这条发布？" : "确认下架？"}
			>
				<div className="mk-dialog-body">
					<p>{confirmation?.listing.title}</p>
					<p className="mk-muted">
						{confirmation?.action === "delete"
							? "删除后无法恢复。已有咨询记录仍会保留。"
							: "下架后其他人无法浏览，之后可以重新上架。"}
					</p>
					{failure && (
						<p role="alert" className="mk-error">
							{failure}
						</p>
					)}
					<div className="mk-form-actions">
						<button type="button" className="mk-button" disabled={busy} onClick={() => setConfirmation(null)}>
							取消
						</button>
						<button
							type="button"
							className="mk-button mk-primary"
							disabled={busy}
							onClick={() => {
								if (!confirmation) return;
								const { listing, action } = confirmation;
								void perform(() => (action === "delete" && onDelete ? onDelete(listing.id) : onToggle(listing.id)));
							}}
						>
							{busy ? "处理中…" : confirmation?.action === "delete" ? "确认删除" : "确认下架"}
						</button>
					</div>
				</div>
			</MarketDialog>
		</section>
	);
}
