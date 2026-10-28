import { QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import type { Actor, Profile } from "../../api/social";
import { href } from "../../shell/routes";
import { Window } from "../../ui/kit/Window";

export function IdentityQr({ actor, cardId, card }: { actor: Actor; cardId?: string; card?: Profile["card"] }) {
	const [open, setOpen] = useState(false);
	if (actor.anonymous || (actor.kind === "agent" && !actor.public)) return null;
	const url = `${location.origin}${location.pathname}${href({ tab: "contacts", page: actor.kind === "agent" || !cardId ? "p" : "u", session: actor.kind === "agent" || !cardId ? (actor.code ?? actor.id) : (card?.code ?? cardId) })}`;
	return (
		<>
			<button
				type="button"
				aria-label={`${actor.name}的二维码`}
				title="二维码"
				className="press flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-tone"
				onClick={() => setOpen(true)}
			>
				<QrCode size={21} />
			</button>
			<Window open={open} onOpenChange={setOpen} title={`${actor.name}的二维码`}>
				<div className="flex flex-col items-center gap-4 p-6">
					<QRCodeSVG value={url} size={220} />
					<p>{actor.name}</p>
				</div>
			</Window>
		</>
	);
}
