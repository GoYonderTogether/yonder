import type { ContextSnapshot, ModelStatus, UsageTotals } from "@yonder/gateway/protocol";
import type { FooterStats } from "../api/session-state";

export function clock(iso?: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const now = new Date();
	const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const diff = (day(now) - day(d)) / 86_400_000;
	const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	if (diff === 0) return hm;
	if (diff === 1) return "昨天";
	if (diff < 7) return `周${"日一二三四五六"[d.getDay()]}`;
	return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 1234 → 1.2k，与 pi footer 一致 */
export function tokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

export function badge(n: number): string {
	return n > 99 ? "99+" : String(n);
}

export function hue(seed: string): number {
	let h = 0;
	for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
	return h;
}

/** 零值按「没有」处理：pi footer 也不为 0 占位，未知与零都不伪造。 */
const has = (n: number | undefined): n is number => typeof n === "number" && n > 0;

function inOut(input?: number, output?: number): string[] {
	const parts: string[] = [];
	if (has(input)) parts.push(`↑${tokens(input)}`);
	if (has(output)) parts.push(`↓${tokens(output)}`);
	return parts;
}

/** 本会话用量：↑输入 ↓输出 R缓存读 W缓存写 CH命中率（contracts §3.3）。 */
export function usageLine(u?: UsageTotals, cacheHitPct?: number): string | undefined {
	if (!u) return undefined;
	const parts = inOut(u.input, u.output);
	if (has(u.cacheRead)) parts.push(`R${tokens(u.cacheRead)}`);
	if (has(u.cacheWrite)) parts.push(`W${tokens(u.cacheWrite)}`);
	// CH 只认真实的 usage.last.cacheHitPct，不按 totals 反推；分母为零时上游不给这个值。
	if ((has(u.cacheRead) || has(u.cacheWrite)) && typeof cacheHitPct === "number")
		parts.push(`CH${cacheHitPct.toFixed(1)}%`);
	return parts.length ? parts.join(" ") : undefined;
}

/** 子 Agent 汇总：sub-agents ↑输入 ↓输出；没有子 Agent 用量就不显示。 */
export function childrenLine(c?: UsageTotals): string | undefined {
	const parts = inOut(c?.input, c?.output);
	return parts.length ? `sub-agents ${parts.join(" ")}` : undefined;
}

/** 上下文：60.5%/200k (auto)；没有占用但知道窗口时显示 ?/200k。 */
export function contextLine(c?: ContextSnapshot, window?: number): string | undefined {
	if (c) return `${c.percent.toFixed(1)}%/${tokens(c.window)}${c.auto ? " (auto)" : ""}`;
	return typeof window === "number" && window > 0 ? `?/${tokens(window)}` : undefined;
}

/** LSP 状态；协议有 lsp 字段但当前没有生产者，没有数据就不显示。 */
export function lspLine(l?: { name: string; state: string }): string | undefined {
	if (!l?.name) return undefined;
	return `LSP ${l.state}: ${l.name}`;
}

/** (provider) 模型 • 思考档；路由命中时显示实际模型。 */
export function modelLine(m?: ModelStatus): string | undefined {
	if (!m) return undefined;
	const name = m.routedTo ? `${m.model} → ${m.routedTo.model}` : m.model;
	if (!name) return undefined;
	const provider = m.provider ? `(${m.provider}) ` : "";
	return `${provider}${name}${m.thinking ? ` • ${m.thinking}` : ""}`;
}

export interface FooterSegments {
	usage?: string;
	children?: string;
	context?: string;
	lsp?: string;
	model?: string;
}

/** 底栏各段；缺失的字段整段省略，Footer 只负责摆放和着色。 */
export function footerSegments(s: FooterStats): FooterSegments {
	const usage = usageLine(s.usage, s.cacheHitPct);
	const children = childrenLine(s.children);
	const context = contextLine(s.context, s.contextWindow);
	const lsp = lspLine(s.lsp);
	const model = modelLine(s.model);
	return {
		...(usage ? { usage } : {}),
		...(children ? { children } : {}),
		...(context ? { context } : {}),
		...(lsp ? { lsp } : {}),
		...(model ? { model } : {}),
	};
}
