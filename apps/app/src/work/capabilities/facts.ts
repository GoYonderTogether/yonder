import type { NodeFacts } from "../api/types";

declare global {
	interface Window {
		/**
		 * 客户端壳标记（contracts §17）：只认 "desktop" | "mobile" 字符串。
		 * 不注入表示 Web；客户端壳不属于 NodeFacts，节点事实里没有这个字段，不能从 facts 推断。
		 */
		__YONDER_SHELL__?: string;
	}
}

/** 应用要求的最低节点协议（contracts §5、§12）；低于它的节点按「版本较旧」处理。 */
export const APP_MIN_PROTOCOL = 1;

/** 客户端壳。只有桌面壳渲染顶栏，手机壳与浏览器都不渲染。 */
export type Shell = "web" | "desktop" | "mobile";

const SHELL_LABEL: Record<Shell, string> = { web: "浏览器", desktop: "桌面壳", mobile: "手机" };
export const shellLabel = (shell: Shell): string => SHELL_LABEL[shell];

/**
 * 注入值的白名单：只有字符串 "desktop" 与 "mobile" 生效。
 * 未注入、旧版的布尔/对象注入、其它未知值都按 Web，不猜。
 */
export function shellOf(injected: unknown): Shell {
	return injected === "desktop" || injected === "mobile" ? injected : "web";
}

export interface ClientFacts {
	shell: Shell;
	/** 本机平台串，只用于外观（标题栏留白等），不参与功能判定。 */
	platform: string;
	mac: boolean;
}

/** 读注入的壳标记；没有 window（测试、SSR）时按 Web。 */
export function readShell(
	win: { __YONDER_SHELL__?: unknown } | undefined = typeof window === "undefined" ? undefined : window,
): Shell {
	return shellOf(win?.__YONDER_SHELL__);
}

/** 壳与外观：壳只来自注入，平台外观本地检测。 */
export function clientFacts(
	win: { __YONDER_SHELL__?: unknown } | undefined = typeof window === "undefined" ? undefined : window,
	platform: string = typeof navigator === "undefined" ? "" : (navigator.platform ?? ""),
): ClientFacts {
	return { shell: readShell(win), platform, mac: /mac/i.test(platform) };
}

/** 前端判定功能可见性所需的节点事实（contracts §4/§12）；只报事实，不报「显示什么」。 */
export interface NodeCapabilityFacts {
	/** 节点协议版本；还没拿到 capabilities.get 时为 undefined。 */
	protocol: number | undefined;
	nodeKind: "local" | "remote" | undefined;
	granted: readonly string[];
	methods: Readonly<Record<string, unknown>>;
	features: Readonly<Record<string, boolean | undefined>>;
	events: readonly string[];
}

/** 把 capabilities.get 的结果收敛成判定用的事实；缺失字段一律按「没有」，不伪造。 */
export function nodeCapabilityFacts(facts: Partial<NodeFacts> | undefined | null): NodeCapabilityFacts {
	const kind = facts?.kind;
	return {
		protocol: typeof facts?.protocol === "number" ? facts.protocol : undefined,
		nodeKind: kind === "local" || kind === "remote" ? kind : undefined,
		granted: facts?.granted ?? [],
		methods: facts?.methods ?? {},
		features: facts?.features ?? {},
		events: facts?.events ?? [],
	};
}
