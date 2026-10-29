import { QRCodeCanvas } from "qrcode.react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import type { Actor, Card } from "../api/types";
import { type CardItem, canShareCard, cardUrl, faceProps } from "../lib/cardItems";
import { type ShareTarget, useShareUrl } from "../lib/useShareUrl";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { CardQrView } from "./card/CardFace";
import { renderCardImage } from "./card/image";
import { ShareLinks } from "./ShareLinks";

/** 同一个大码呈现和保存出口，导出不承载自定义介绍封面。 */
export function CardShare({
	url,
	card,
	actor,
}: {
	url: string;
	card?: Pick<Card, "summary" | "tagline" | "face">;
	actor: Actor;
}) {
	const qr = useRef<HTMLCanvasElement>(null);
	const [image, setImage] = useState("");
	const headline = card?.face?.headline?.trim() || card?.tagline || card?.summary || actor.summary;
	const allowed = actor.kind !== "agent" || actor.public === true;
	const sig = JSON.stringify([
		actor.name,
		actor.avatarUrl,
		actor.kind,
		actor.online,
		headline,
		card?.face?.theme,
		url,
		allowed,
	]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 按签名 sig 重画分享图，sig 已涵盖这些字段
	useEffect(() => {
		setImage("");
		if (!allowed || !qr.current) return;
		let active = true;
		renderCardImage({
			name: actor.name,
			avatarUrl: actor.avatarUrl,
			onAvatarError: () => active && toast("头像无法用于保存图片，已用默认头像；请检查图片链接或跨域设置", true),
			agent: actor.kind === "agent",
			online: actor.online,
			headline,
			face: card?.face,
			qr: qr.current,
		})
			.then((src) => active && setImage(src))
			.catch(() => toast("二维码名片生成失败", true));
		return () => {
			active = false;
		};
	}, [sig]);
	if (!allowed) return <p className="p-4 text-small text-muted">此 Bot 未公开，无法分享二维码</p>;
	return (
		<div className="mx-auto flex w-full max-w-[360px] flex-col gap-4">
			<div hidden>
				<QRCodeCanvas ref={qr} value={url} size={720} marginSize={0} bgColor="#ffffff" fgColor="#000000" />
			</div>
			<CardQrView actor={actor} url={url} headline={headline} theme={card?.face?.theme} />
			<a href={image || undefined} download={`${actor.name}-二维码名片.png`} className="contents">
				<Button variant="primary" className="h-11" disabled={!image}>
					保存二维码名片
				</Button>
			</a>
		</div>
	);
}

export function QrDialog({
	actor,
	card,
	url,
	share,
	open,
	onOpenChange,
}: {
	actor: Actor;
	card?: Pick<Card, "summary" | "tagline" | "face"> | null;
	url: string;
	/** 自己的名片：二维码改用服务端分享链接，并显示配额入口 */
	share?: ShareTarget;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const shareUrl = useShareUrl(share, url, open);
	return (
		<Dialog.Root open={open && (actor.kind !== "agent" || actor.public === true)} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fade fixed inset-0 z-40 bg-black/30" />
				<Dialog.Content
					aria-describedby={undefined}
					className="rise fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(392px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-[24px] bg-raised p-4 shadow-float outline-none"
				>
					<Dialog.Title className="text-small font-semibold">二维码名片</Dialog.Title>
					<CardShare actor={actor} card={card ?? undefined} url={shareUrl} />
					{share && (
						<div className="flex justify-center">
							<ShareLinks kind={share.kind} targetId={share.targetId} label={actor.name} path={share.path} />
						</div>
					)}
					<Dialog.Close asChild>
						<Button className="h-11">关闭</Button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export function CardShareDialog({
	item,
	open,
	onOpenChange,
}: {
	item: CardItem;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const p = faceProps(item);
	const url = cardUrl(item);
	return (
		<QrDialog
			actor={item.actor}
			card={{ summary: p.headline ?? null, face: p.face }}
			url={url}
			share={
				item.card?.mine ? { kind: "card", targetId: item.card.id, path: url.slice(location.origin.length) } : undefined
			}
			open={open && canShareCard(item)}
			onOpenChange={onOpenChange}
		/>
	);
}
