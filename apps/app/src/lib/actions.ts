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

/** 统一构造菜单项；各页面不再自己拼对象。 */
export function action(
	key: string,
	label: string,
	onSelect: () => void,
	extra?: Partial<Pick<ActionItem, "icon" | "checked" | "danger">>,
): ActionItem {
	return { key, label, onSelect, ...extra };
}

/** 开关项：label 随状态切换（如置顶 / 取消置顶）。 */
export function toggleItem(
	key: string,
	on: boolean,
	onLabel: string,
	offLabel: string,
	onSelect: () => void,
	icon?: ActionItem["icon"],
): ActionItem {
	return action(key, on ? onLabel : offLabel, onSelect, { icon });
}

/** 单选组的一项：当前选中的项带 checked 标记。 */
export function choiceItem(
	key: string,
	label: string,
	selected: boolean,
	onSelect: () => void,
	icon?: ActionItem["icon"],
): ActionItem {
	return action(key, label, onSelect, { icon, checked: selected });
}

/** 组装菜单：条件不成立的项传 false / null / undefined，结果保持原有顺序。 */
export function menuItems(items: readonly (ActionItem | false | null | undefined)[]): ActionItem[] {
	return items.filter((item): item is ActionItem => Boolean(item));
}

/** 方向键在菜单项之间循环；焦点不在菜单内时，向下从第一项开始，向上从最后一项开始。 */
export function stepIndex(current: number, length: number, delta: 1 | -1): number {
	if (length <= 0) return -1;
	if (current < 0 || current >= length) return delta === 1 ? 0 : length - 1;
	return (current + delta + length) % length;
}
