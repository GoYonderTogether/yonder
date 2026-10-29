import { useLocation } from "react-router";

/** 工作区路由（挂在 /work/*）：/work、/work/:session、/work/console、/work/market、/work/settings。 */
export const WORK_PAGES = ["console", "market", "settings"] as const;
export type WorkPage = (typeof WORK_PAGES)[number];
export type WorkRoute = { page?: WorkPage; session?: string };

/** pathname 是 router 内的路径（已去掉 basename）。 */
export function parseWork(pathname: string): WorkRoute {
	const [head] = pathname.replace(/^\/work\/?/, "").split("/");
	if (!head) return {};
	if ((WORK_PAGES as readonly string[]).includes(head)) return { page: head as WorkPage };
	try {
		return { session: decodeURIComponent(head) };
	} catch {
		return {};
	}
}

export function workPath(r: WorkRoute = {}): string {
	if (r.page) return `/work/${r.page}`;
	return r.session ? `/work/${encodeURIComponent(r.session)}` : "/work";
}

export const useWorkRoute = (): WorkRoute => parseWork(useLocation().pathname);
