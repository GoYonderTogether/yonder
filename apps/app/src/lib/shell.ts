import { useFacts } from "./queries";

declare global {
	interface Window {
		__YONDER_SHELL__?: { platform?: string } | boolean | string;
	}
}

/**
 * 桌面壳模式：壳注入 window.__YONDER_SHELL__，或节点事实里 shell=desktop。
 * 浏览器访问两者都没有，不渲染顶部栏。
 */
export function useShell(): { desktop: boolean; mac: boolean } {
	const facts = useFacts().data as ({ shell?: string; capabilities?: { shell?: string } } & object) | undefined;
	const injected = typeof window !== "undefined" ? window.__YONDER_SHELL__ : undefined;
	const desktop = Boolean(injected) || facts?.shell === "desktop" || facts?.capabilities?.shell === "desktop";
	const platform = typeof injected === "object" && injected.platform ? injected.platform : (navigator.platform ?? "");
	return { desktop, mac: /mac/i.test(platform) };
}
