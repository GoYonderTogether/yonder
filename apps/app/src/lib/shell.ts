import { clientFacts, type Shell } from "../capabilities/facts";

export type { Shell } from "../capabilities/facts";

/**
 * 客户端壳：只认壳注入的 window.__YONDER_SHELL__（"desktop" | "mobile" 字符串，不注入=web）。
 * 节点事实里没有客户端壳字段，不从 NodeFacts 推断；平台外观（mac）才用本机检测。
 */
export function useShell(): { shell: Shell; desktop: boolean; mac: boolean } {
	const facts = clientFacts();
	return { shell: facts.shell, desktop: facts.shell === "desktop", mac: facts.mac };
}
