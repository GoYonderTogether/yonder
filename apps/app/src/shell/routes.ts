import { useEffect, useState } from "react";

/** 一级导航就是三项（消息 / 通讯录 / 工作）+ 底部头像进「我」；控制台属于「工作」，不新增导航项。 */
export type Tab = "chats" | "contacts" | "work" | "me";
export const PAGE_NAMES = [
	"s",
	"c",
	"contacts",
	"cards",
	"work",
	"me",
	"u",
	"p",
	"g",
	"get",
	"friends/add",
	"connect",
	"market",
	"console",
] as const;
export type Page = (typeof PAGE_NAMES)[number];
export type Route = { tab: Tab; session?: string; page?: Page };

export function parse(hash: string): Route {
	const parts = hash.replace(/^#\/?/, "").split("/");
	const page = parts[0] === "friends" && parts[1] === "add" ? "friends/add" : (parts[0] ?? "");
	const id = page === "friends/add" ? undefined : parts[1];
	// console 归在「工作」下：图标栏与底栏仍是三项，控制台是工作页里的入口。
	const tab: Tab =
		page === "contacts" || page === "cards"
			? "contacts"
			: page === "work" || page === "console"
				? "work"
				: page === "me"
					? "me"
					: "chats";
	if (!(PAGE_NAMES as readonly string[]).includes(page)) return { tab: "chats" };
	try {
		return { tab, page: page as Page, ...(id ? { session: decodeURIComponent(id) } : {}) };
	} catch {
		return { tab: "chats" };
	}
}
export function href(r: Route): string {
	const page = r.page ?? (r.tab === "chats" ? (r.session ? "s" : "") : r.tab);
	return `#/${page}${r.session ? `/${encodeURIComponent(r.session)}` : ""}`;
}
export function useRoute(): Route {
	const [route, setRoute] = useState(() => parse(location.hash));
	useEffect(() => {
		const fn = () => setRoute(parse(location.hash));
		addEventListener("hashchange", fn);
		return () => removeEventListener("hashchange", fn);
	}, []);
	return route;
}
export const useMedia = (q: string) => {
	const [m, setM] = useState(() => matchMedia(q).matches);
	useEffect(() => {
		const mq = matchMedia(q);
		const fn = () => setM(mq.matches);
		mq.addEventListener("change", fn);
		return () => mq.removeEventListener("change", fn);
	}, [q]);
	return m;
};
