import { Link2, QrCode } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { copyText } from "../lib/cardActions";
import { type CardItem, canShareCard, cardUrl, faceProps } from "../lib/cardItems";
import { cn } from "../lib/cn";
import { entityRef } from "../lib/entityRef";
import { internalState } from "../lib/navigation";
import { Button } from "../ui/Button";
import { CardShareDialog } from "./CardShare";
import { CardFaceView, CardQrView } from "./card/CardFace";

export function BigCard({
	item,
	variant = "intro",
	className,
}: {
	item: CardItem;
	variant?: "intro" | "qr";
	className?: string;
}) {
	const p = faceProps(item);
	return variant === "qr" ? (
		canShareCard(item) ? (
			<CardQrView
				actor={item.actor}
				url={cardUrl(item)}
				headline={p.face?.headline || p.headline}
				theme={p.face?.theme}
			/>
		) : (
			<p className="p-4 text-small text-muted">此名片暂不可公开分享</p>
		)
	) : (
		<CardFaceView {...p} className={className} />
	);
}

/** 卡面只负责翻卡，详情和分享操作明确放在卡外。 */
export function CardActions({ item, row }: { item: CardItem; row?: boolean }) {
	const [sharing, setSharing] = useState(false);
	const nav = useNavigate();
	const loc = useLocation();
	const detail = `/contacts/${entityRef(item.actor)}${item.card?.kind === "persona" ? `?card=${encodeURIComponent(entityRef(item.card))}` : ""}`;
	const share = canShareCard(item);
	return (
		<div className={cn("flex gap-2", row ? "flex-wrap justify-center" : "w-full flex-col")}>
			<Button className="h-11" onClick={() => nav(detail, { state: internalState(loc) })}>
				查看详情
			</Button>
			{share && (
				<>
					<Button className="h-11" onClick={() => setSharing(true)}>
						<QrCode size={16} />
						二维码
					</Button>
					<Button className="h-11" onClick={() => copyText(cardUrl(item))}>
						<Link2 size={16} />
						复制链接
					</Button>
				</>
			)}
			{!share && (
				<span className="self-center text-caption text-muted">
					{item.actor.kind === "agent" && !item.actor.public ? "私有 Agent · 仅本人可见" : "未发布 · 暂不可分享"}
				</span>
			)}
			<CardShareDialog item={item} open={sharing} onOpenChange={setSharing} />
		</div>
	);
}
