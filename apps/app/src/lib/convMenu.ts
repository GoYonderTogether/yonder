import { BellOff, BellRing, CheckCheck, Pin, PinOff } from "lucide-react";
import { type ActionItem, action, choiceItem, menuItems, toggleItem } from "../work/lib/actions";
import type { NotifyLevel } from "../work/lib/prefs";

/**
 * 会话行：置顶、免打扰三档、标为已读。
 * 与旧版 SessionList 同一套动作，数据仍走 yonder.prefs（不新开存储）。
 */
export function convRowMenu(o: {
	pinned: boolean;
	level: NotifyLevel;
	pin(): void;
	setLevel(level: NotifyLevel): void;
	markRead(): void;
}): ActionItem[] {
	return menuItems([
		toggleItem("pin", o.pinned, "取消置顶", "置顶", o.pin, o.pinned ? PinOff : Pin),
		choiceItem("all", "免打扰：关闭", o.level === "all", () => o.setLevel("all"), BellRing),
		choiceItem("mentions", "免打扰：仅提问与审批", o.level === "mentions", () => o.setLevel("mentions"), BellRing),
		choiceItem("mute", "免打扰：静音", o.level === "mute", () => o.setLevel("mute"), BellOff),
		action("read", "标为已读", o.markRead, { icon: CheckCheck }),
	]);
}
