import { useLocation } from "react-router";
import { activeNode } from "../api/nodes";

/** 工作区路由（挂在 /work/*）：/work、/work/:session、/work/console、/work/market、/work/settings。 */
export const WORK_PAGES = ["console", "market", "settings"] as const;
export type WorkPage = (typeof WORK_PAGES)[number];
export type WorkRoute = { page?: WorkPage; session?: string; deviceId?: string };

/** pathname 是 router 内的路径（已去掉 basename）。 */
export function parseWork(pathname: string): WorkRoute {
	const [head, device, session] = pathname.replace(/^\/work\/?/, "").split("/");
	if (!head) return {};
	if (head === "device" && device && session) {
		try {
			return { deviceId: decodeURIComponent(device), session: decodeURIComponent(session) };
		} catch {
			return {};
		}
	}
	if ((WORK_PAGES as readonly string[]).includes(head)) return { page: head as WorkPage };
	try {
		return { session: decodeURIComponent(head) };
	} catch {
		return {};
	}
}

export function workPath(r: WorkRoute = {}): string {
	if (r.page) return `/work/${r.page}`;
	const device = r.deviceId ?? activeNode().deviceId;
	if (r.session && device) return `/work/device/${encodeURIComponent(device)}/${encodeURIComponent(r.session)}`;
	return r.session ? `/work/${encodeURIComponent(r.session)}` : "/work";
}

export const useWorkRoute = (): WorkRoute => parseWork(useLocation().pathname);
