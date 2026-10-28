import { useEffect, useState } from "react";

/** 与图标栏一一对应：消息 / 通讯录 / 工作 / 我。会话 id 跟在后面。 */
export type Tab = "chats" | "contacts" | "work" | "me";
export type Route = { tab: Tab; session?: string };

export function parse(hash: string): Route {
	const p = hash.replace(/^#\/?/, "").split("/");
	if (p[0] === "s" && p[1]) return { tab: "chats", session: decodeURIComponent(p[1]) };
	if (p[0] === "contacts" || p[0] === "work" || p[0] === "me")
		return { tab: p[0], session: p[1] ? decodeURIComponent(p[1]) : undefined };
	return { tab: "chats" };
}
export function href(r: Route): string {
	if (r.tab === "chats") return r.session ? `#/s/${encodeURIComponent(r.session)}` : "#/";
	return r.session ? `#/${r.tab}/${encodeURIComponent(r.session)}` : `#/${r.tab}`;
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
