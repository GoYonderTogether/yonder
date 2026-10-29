import {
	ChevronDown,
	ChevronUp,
	CircleX,
	Copy,
	IdCard,
	MessageCircle,
	MessageSquare,
	PanelRightClose,
	PictureInPicture2,
	Pin,
	PinOff,
} from "lucide-react";
import type { Actor } from "../api/social/types";
import type { SessionInfo } from "../api/types";
import { type ActionItem, action, menuItems, toggleItem } from "./actions";
import { dock, type PanelKind, toggleFloat } from "./layout";
import { togglePin } from "./prefs";
import { taskStatus } from "./work";

// 各行的统一上下文菜单。只构造真实已有动作：导航、RPC 这类需要页面上下文的手势由调用方传入，
// 置顶、复制、面板布局直接复用 lib/prefs 与 lib/layout 的现有函数。
// 右键、长按与键盘打开由 useMenuTrigger 负责，渲染由 ActionMenu 负责。

/** Bot 行：打开会话、复制标题。 */
export function botRowMenu(o: { title: string; open(): void }): ActionItem[] {
	return menuItems([
		action("open", "打开会话", o.open, { icon: MessageSquare }),
		action("copy", "复制标题", () => void navigator.clipboard?.writeText(o.title), { icon: Copy }),
	]);
}

/** 任务行：打开会话、关闭会话、置顶；已关闭的任务不再显示关闭项。 */
export function taskRowMenu(o: { session: SessionInfo; pinned: boolean; open(): void; close(): void }): ActionItem[] {
	const closed = taskStatus(o.session) === "done";
	return menuItems([
		action("open", "打开会话", o.open, { icon: MessageSquare }),
		!closed && action("close", "关闭会话", o.close, { icon: CircleX, danger: true }),
		toggleItem("pin", o.pinned, "取消置顶", "置顶", () => togglePin(o.session.id), o.pinned ? PinOff : Pin),
	]);
}

/** 联系人行：发消息、打开资料；自己不发消息给自己（与资料页一致）。 */
export function contactRowMenu(o: { actor: Actor; meId?: string; message(): void; profile(): void }): ActionItem[] {
	const self = o.meId !== undefined && o.actor.id === o.meId;
	return menuItems([
		!self && action("message", "发消息", o.message, { icon: MessageCircle }),
		action("profile", "打开资料", o.profile, { icon: IdCard }),
	]);
}

/** 面板标题：右栏卡片可弹出，悬浮窗可停靠回右栏并收起/展开；都走 lib/layout 的现有函数。 */
export function panelMenu(o: {
	session: string;
	placement: "floating" | "rail";
	kind: PanelKind;
	collapsed?: boolean;
	onToggleCollapse?(): void;
}): ActionItem[] {
	const floating = o.placement === "floating";
	const toggle = o.onToggleCollapse;
	return menuItems([
		floating
			? action("dock", "停靠到右栏", () => dock(o.session, o.kind), { icon: PanelRightClose })
			: action("float", "弹出为悬浮窗", () => toggleFloat(o.session, o.kind), { icon: PictureInPicture2 }),
		floating && toggle
			? action("collapse", o.collapsed ? "展开" : "收起", toggle, {
					icon: o.collapsed ? ChevronDown : ChevronUp,
				})
			: null,
	]);
}
