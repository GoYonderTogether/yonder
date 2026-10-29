import { appBase } from "./base";
/** Accept only public identity routes; preserve their query and record real scanner input. */
export function profileRoute(input: string, source?: "scan" | "link"): string | undefined {
	try {
		const text = input.trim();
		if (!text) return undefined;
		const url = new URL(/^(?:https?:\/\/|\/)/.test(text) ? text : `/p/${encodeURIComponent(text)}`, location.origin);
		// 网关托管时链接带部署 base（/console/u/<code>），路由本身不带 base，先剥掉再校验。
		const base = appBase();
		const path = base !== "/" && url.pathname.startsWith(base) ? url.pathname.slice(base.length - 1) : url.pathname;
		if (!/^\/(?:u|p)\/[^/]+\/?$/.test(path)) return undefined;
		if (source === "scan") url.searchParams.set("s", "scan");
		return path + url.search;
	} catch {
		return undefined;
	}
}
