import { tokens } from "../lib/format";
import type { SessionView } from "../lib/useSession";

/** 参照 pi footer：↑输入 ↓输出 · 上下文百分比/窗口 · (provider) 模型 • 思考档 */
export function Footer({ v }: { v: SessionView }) {
	const u = v.usage?.self;
	const c = v.context;
	const m = v.model;
	const tone = !c ? "" : c.percent > 90 ? "text-danger" : c.percent > 70 ? "text-[#b7791f]" : "";
	return (
		<footer
			className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-hairline px-4 py-1.5 font-mono text-caption text-faint"
			data-testid="footer"
		>
			{u && (
				<span>
					↑{tokens(u.input)} ↓{tokens(u.output)}
				</span>
			)}
			{u && u.cacheRead > 0 && <span>缓存 {tokens(u.cacheRead)}</span>}
			{!c && m?.contextWindow && <span>?/{tokens(m.contextWindow)}</span>}
			{c && (
				<span className={tone}>
					{c.percent.toFixed(1)}%/{tokens(c.window)}
					{c.auto ? " (自动压缩)" : ""}
				</span>
			)}
			{m && (
				<span className="ml-auto">
					{m.provider ? `(${m.provider}) ` : ""}
					{m.routedTo ? `${m.model} → ${m.routedTo.model}` : m.model}
					{m.thinking ? ` • ${m.thinking}` : ""}
				</span>
			)}
			{!u && !c && !m && <span>等待会话状态…</span>}
		</footer>
	);
}
