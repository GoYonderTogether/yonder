import { QrCode } from "lucide-react";
import { useState } from "react";
import type { Actor, Profile } from "../api/types";
import { appPath } from "../lib/base";
import { entityRef } from "../lib/entityRef";
import { QrDialog } from "./CardShare";

/** The same large-code view is used from identity pages and the card stack. */
export function IdentityQr({
	actor,
	cardId,
	card,
	mine,
}: {
	actor: Actor;
	cardId?: string;
	card?: Profile["card"];
	/** 这张名片是自己的：二维码改用服务端分享链接 */
	mine?: boolean;
}) {
	const [open, setOpen] = useState(false);
	if (actor.anonymous || (actor.kind === "agent" && !actor.public)) return null;
	// 地址要带部署 base：网关托管时应用在 /console/ 下，丢 base 的二维码会落到站点根。
	const path = actor.kind === "agent" || !cardId ? `/p/${entityRef(actor)}` : `/u/${card?.code ?? cardId}`;
	const url = `${location.origin}${appPath(path)}`;
	return (
		<>
			<button
				type="button"
				aria-label={`${actor.name}的二维码`}
				title="二维码"
				className="press flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-tone"
				onClick={() => setOpen(true)}
			>
				<QrCode size={21} strokeWidth={1.75} />
			</button>
			<QrDialog
				actor={actor}
				card={card}
				url={url}
				share={mine && cardId ? { kind: "card", targetId: cardId, path: url.slice(location.origin.length) } : undefined}
				open={open}
				onOpenChange={setOpen}
			/>
		</>
	);
}
