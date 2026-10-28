import { type ComponentType, createElement, lazy } from "react";
import type { Page, Tab } from "./routes";

/** 路由 id 段（如 #/c/:id 的 :id）；有 id 的页面传入，其余忽略。 */
export type PageProps = { id: string };

export type PageDef = {
	tab: Tab;
	/** 公共页：不需要网关登录，也不进外壳。 */
	public?: boolean;
	/** 必须带 id 才渲染（否则回落到外壳的列表/空态）。 */
	needsId?: boolean;
	/** 无 load 的页面由外壳内置渲染（聊天、列表、设置）。 */
	load?: () => Promise<{ default: ComponentType<PageProps> }>;
	title: string;
};

export const PAGES: Record<Page, PageDef> = {
	s: { tab: "chats", title: "消息" },
	c: {
		tab: "chats",
		title: "聊天",
		needsId: true,
		load: () => import("../features/social/SocialChat").then((m) => ({ default: m.SocialChat })),
	},
	contacts: {
		tab: "contacts",
		title: "联系人",
		needsId: true,
		load: () => import("../features/social/ContactDetail").then((m) => ({ default: m.ContactDetail })),
	},
	cards: {
		tab: "contacts",
		title: "名片",
		load: () => import("../features/social/CardPage").then((m) => ({ default: m.CardPage })),
	},
	work: { tab: "work", title: "工作" },
	me: {
		tab: "me",
		title: "我",
		load: () => import("../features/social/Profile").then((m) => ({ default: () => createElement(m.Profile, {}) })),
	},
	u: {
		tab: "chats",
		public: true,
		title: "名片",
		load: () => import("../features/social/CardPage").then((m) => ({ default: m.CardPage })),
	},
	p: {
		tab: "chats",
		public: true,
		title: "主页",
		load: () =>
			import("../features/social/Profile").then((m) => ({
				default: ({ id }) => createElement(m.Profile, { accountId: id }),
			})),
	},
	g: {
		tab: "chats",
		public: true,
		title: "加入群组",
		load: () =>
			import("../features/social/GroupJoin").then((m) => ({
				default: ({ id }) => createElement(m.GroupJoin, { token: id }),
			})),
	},
	get: {
		tab: "chats",
		public: true,
		title: "安装",
		load: () => import("../features/social/Install").then((m) => ({ default: m.Install })),
	},
	"friends/add": {
		tab: "contacts",
		title: "添加朋友",
		load: () => import("../features/social/AddFriend").then((m) => ({ default: m.AddFriend })),
	},
	connect: {
		tab: "chats",
		public: true,
		title: "连接",
		load: () => import("../features/social/Connect").then((m) => ({ default: m.Connect })),
	},
	market: {
		tab: "chats",
		title: "市场",
		load: () => import("../features/market/Market").then((m) => ({ default: m.Market })),
	},
};

const cache = new Map<Page, ComponentType<PageProps>>();
/** 同一页面复用同一个 lazy 组件，避免重渲染时重新挂载。 */
export function pageComponent(page: Page): ComponentType<PageProps> | undefined {
	const load = PAGES[page].load;
	if (!load) return undefined;
	let c = cache.get(page);
	if (!c) {
		c = lazy(load);
		cache.set(page, c);
	}
	return c;
}
