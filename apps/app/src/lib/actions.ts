import type { ComponentType } from "react";

/** 右键菜单与长按菜单共用的同一份动作列表。 */
export interface ActionItem {
	key: string;
	label: string;
	icon?: ComponentType<{ size?: number; className?: string }>;
	/** 当前选中（用于免打扰三档的单选标记） */
	checked?: boolean;
	danger?: boolean;
	onSelect: () => void;
}
