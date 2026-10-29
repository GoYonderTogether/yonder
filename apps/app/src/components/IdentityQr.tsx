import { QrCode } from "lucide-react";
import { useState } from "react";
import type { Actor, Profile } from "../api/types";
import { entityRef } from "../lib/entityRef";
import { QrDialog } from "./CardShare";

/** The same large-code view is used from identity pages and the card stack. */
export function IdentityQr({ actor, cardId, card }: { actor: Actor; cardId?: string; card?: Profile["card"] }) {
	const [open, setOpen] = useState(false);
	if (actor.anonymous || (actor.kind === "agent" && !actor.public)) return null;
	const url = `${location.origin}${actor.kind === "agent" || !cardId ? `/p/${entityRef(actor)}` : `/u/${card?.code ?? cardId}`}`;
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
			<QrDialog actor={actor} card={card} url={url} open={open} onOpenChange={setOpen} />
		</>
	);
}
