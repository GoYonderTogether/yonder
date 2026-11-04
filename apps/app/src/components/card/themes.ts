import type { CardFace } from "../../api/types";

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

/**
 * 钱包缩略卡（CardFaceView / 保存图）统一的纸墨配色；theme 字段仅为后端兼容保留，
 * 不再改变卡面颜色。
 */
export const THEMES: Record<ThemeName, Palette> = {
	mist: {
		bg: "#f6f3ec",
		fg: "#1a1a19",
		from: "#efeadf",
		to: "#f6f3ec",
		chip: "#efeadf",
		footbg: "#efeadf",
		avbg: "#e7e2d6",
		avfg: "#1a1a19",
		hibg: "#1a1a19",
		hifg: "#f6f3ec",
		stickerbg: "#ffffff",
		edge: "#e7e2d6",
	},
	night: {
		bg: "#20201e",
		fg: "#f6f3ec",
		from: "#262625",
		to: "#20201e",
		chip: "#302f2d",
		footbg: "#1a1a19",
		avbg: "#302f2d",
		avfg: "#f6f3ec",
		hibg: "#f6f3ec",
		hifg: "#1a1a19",
		stickerbg: "#302f2d",
		edge: "#302f2d",
	},
	paper: {
		bg: "#f6f3ec",
		fg: "#1a1a19",
		from: "#efeadf",
		to: "#f6f3ec",
		chip: "#efeadf",
		footbg: "#efeadf",
		avbg: "#e7e2d6",
		avfg: "#1a1a19",
		hibg: "#1a1a19",
		hifg: "#f6f3ec",
		stickerbg: "#ffffff",
		edge: "#e7e2d6",
	},
	ink: {
		bg: "#20201e",
		fg: "#f6f3ec",
		from: "#262625",
		to: "#20201e",
		chip: "#302f2d",
		footbg: "#1a1a19",
		avbg: "#302f2d",
		avfg: "#f6f3ec",
		hibg: "#f6f3ec",
		hifg: "#1a1a19",
		stickerbg: "#302f2d",
		edge: "#302f2d",
	},
};
export const THEME_LABEL: Record<ThemeName, string> = { mist: "纸白", night: "深墨", paper: "纸白", ink: "深墨" };
