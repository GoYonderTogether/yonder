import { footerStats } from "../api/session-state";
import { footerSegments } from "../lib/format";
import type { SessionView } from "../lib/useSession";

/** 参照 pi footer：↑输入 ↓输出 R W CH · 子 Agent · LSP · 上下文百分比/窗口 (auto) · (provider) 模型 • 思考档 */
export function Footer({ v }: { v: SessionView }) {
	const seg = footerSegments(footerStats(v));
	const c = v.context;
	const tone = !c ? "" : c.percent > 90 ? "text-danger" : c.percent > 70 ? "text-[#b7791f]" : "";
	const empty = Object.keys(seg).length === 0;
	return (
		<footer
			className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-hairline px-4 py-1.5 font-mono text-caption text-faint"
			data-testid="footer"
		>
			{seg.usage && <span>{seg.usage}</span>}
			{seg.children && <span>{seg.children}</span>}
			{seg.lsp && <span>{seg.lsp}</span>}
			{seg.context && <span className={tone}>{seg.context}</span>}
			{seg.model && <span className="ml-auto">{seg.model}</span>}
			{empty && <span>等待会话状态…</span>}
		</footer>
	);
}
