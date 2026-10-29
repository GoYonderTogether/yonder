import type { CardFace } from "../../../api/social";

export type ThemeName = CardFace["theme"];
export interface Palette {
	bg: string;
	fg: string;
	from: string;
	to: string;
	chip: string;
	footbg: string;
	avbg: string;
	avfg: string;
	hibg: string;
	hifg: string;
	stickerbg: string;
	edge: string;
}

/** 卡面四套主题（card-form.md §3）。只改卡面，应用外框保持黑白。 */
export const THEMES: Record<ThemeName, Palette> = {
	mist: {
		bg: "#fbfaf8",
		fg: "#111111",
		from: "#ecebe7",
		to: "#f5f4f1",
		chip: "#ecebe7",
		footbg: "#f3f2ee",
		avbg: "#dcdad4",
		avfg: "#444444",
		hibg: "#111111",
		hifg: "#ffffff",
		stickerbg: "#ffffff",
		edge: "#e2e0da",
	},
	night: {
		bg: "#3d4767",
		fg: "#ffffff",
		from: "#7b88b3",
		to: "#46506f",
		chip: "#5b6486",
		footbg: "#363f5c",
		avbg: "#cfd6ee",
		avfg: "#2b3350",
		hibg: "#ffffff",
		hifg: "#2b3350",
		stickerbg: "#566087",
		edge: "#56608a",
	},
	paper: {
		bg: "#fdeee9",
		fg: "#8a3b46",
		from: "#f9d9d6",
		to: "#f9d9d6",
		chip: "#f6c9cb",
		footbg: "#f7d3d2",
		avbg: "#ffffff",
		avfg: "#8a3b46",
		hibg: "#ffffff",
		hifg: "#8a3b46",
		stickerbg: "#fff7f2",
		edge: "#f1b7bc",
	},
	ink: {
		bg: "#141414",
		fg: "#f4f4f2",
		from: "#1e1e1e",
		to: "#1e1e1e",
		chip: "#2a2a2a",
		footbg: "#0d0d0d",
		avbg: "#2f2f2f",
		avfg: "#eeeeee",
		hibg: "#f4f4f2",
		hifg: "#111111",
		stickerbg: "#262626",
		edge: "#333333",
	},
};
export const THEME_LABEL: Record<ThemeName, string> = { mist: "雾白", night: "夜蓝", paper: "粉笺", ink: "墨黑" };
