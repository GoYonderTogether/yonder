import { useState } from "react";
import { footerStats } from "../api/session-state";
import { footerSegments } from "../lib/format";
import type { SessionView } from "../lib/useSession";
import { runCommand } from "./ComposerAssist";

const LEVELS = ["auto", "low", "medium", "high"];

/** 底栏模型：点开选思考档位或输入模型，写同一条 sessions.command（与 /思考 /模型 相同）。 */
function ModelPicker({ id, label }: { id: string; label: string }) {
	const [open, setOpen] = useState(false);
	const [model, setModel] = useState("");
	const run = (c: string) => void runCommand(id, c);
	return (
		<span className="relative ml-auto">
			<button type="button" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="model-pick">
				{label}
			</button>
			{open && (
				<div
					className="absolute right-0 bottom-full z-10 mb-1 w-64 rounded-card bg-raised p-2 shadow-float"
					data-testid="model-menu"
				>
					<div className="flex gap-1">
						{LEVELS.map((l) => (
							<button
								key={l}
								type="button"
								onClick={() => run(`effort ${l}`)}
								className="press rounded-full bg-tone px-2 py-0.5"
							>
								{l}
							</button>
						))}
					</div>
					<form
						className="mt-2 flex gap-1"
						onSubmit={(e) => {
							e.preventDefault();
							if (model.trim()) run(`model ${model.trim()}`);
						}}
					>
						<input
							value={model}
							onChange={(e) => setModel(e.target.value)}
							placeholder="provider/model"
							aria-label="模型"
							className="field min-w-0 flex-1 rounded-control bg-tone px-2 py-0.5"
						/>
						<button type="submit" className="press rounded-full bg-tone px-2 py-0.5">
							切换
						</button>
					</form>
					<button type="button" onClick={() => run("model list")} className="press mt-2 underline">
						可用供应商
					</button>
				</div>
			)}
		</span>
	);
}

/** 参照 pi footer：↑输入 ↓输出 R W CH · 子 Agent · LSP · 上下文百分比/窗口 (auto) · (provider) 模型 • 思考档 */
export function Footer({ v }: { v: SessionView }) {
	const seg = footerSegments(footerStats(v));
	const c = v.context;
	const tone = !c ? "" : c.percent > 90 ? "text-danger" : c.percent > 70 ? "text-warn" : "";
	const empty = Object.keys(seg).length === 0;
	return (
		<footer
			className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1.5 font-mono text-caption text-faint tabular-nums"
			data-testid="footer"
		>
			{seg.usage && <span>{seg.usage}</span>}
			{seg.children && <span>{seg.children}</span>}
			{seg.lsp && <span>{seg.lsp}</span>}
			{seg.context && <span className={tone}>{seg.context}</span>}
			{seg.model &&
				(v.session?.id && !v.session.closed ? (
					<ModelPicker id={v.session.id} label={seg.model} />
				) : (
					<span className="ml-auto">{seg.model}</span>
				))}
			{empty && <span>等待会话状态…</span>}
		</footer>
	);
}
