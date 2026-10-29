import { IdCard, MessageCircle } from "lucide-react";
import type { Actor } from "../api/types";
import { type ActionItem, action, menuItems } from "../work/lib/actions";

/** 联系人行：发消息、打开资料；自己不发消息给自己（与资料页一致）。 */
export function contactRowMenu(o: { actor: Actor; meId?: string; message(): void; profile(): void }): ActionItem[] {
	const self = o.meId !== undefined && o.actor.id === o.meId;
	return menuItems([
		!self && action("message", "发消息", o.message, { icon: MessageCircle }),
		action("profile", "打开资料", o.profile, { icon: IdCard }),
	]);
}
