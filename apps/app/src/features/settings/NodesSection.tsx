import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { addNode, removeNode, setActiveNode, useActiveNode, useNodes } from "../../api/nodes";
import { cn } from "../../lib/cn";
import { Field } from "../../ui/kit/Field";
import { toast } from "../../ui/kit/Toast";
import { nodeRows, parseNodeOrigin } from "./rows";

/**
 * 节点分区：本机恒在，可添加远程网关（地址 + 可选访问令牌）。
 * 添加时先登录该节点、再用 capabilities.get 校验协议与 node.id；重复 id 拒绝。
 */
export function NodesSection() {
	const nodes = useNodes();
	const active = useActiveNode();
	const client = useQueryClient();
	const [adding, setAdding] = useState(false);
	const [origin, setOrigin] = useState("");
	const [token, setToken] = useState("");
	const [busy, setBusy] = useState(false);
	const rows = nodeRows(nodes, active.id);
	const submit = async () => {
		const parsed = parseNodeOrigin(origin);
		if (parsed.error || !parsed.origin) {
			toast(parsed.error ?? "节点地址无效", true);
			return;
		}
		setBusy(true);
		try {
			const node = await addNode({ origin: parsed.origin, ...(token.trim() ? { token: token.trim() } : {}) });
			toast(`已添加 ${node.name}`);
			setAdding(false);
			setOrigin("");
			setToken("");
		} catch (error) {
			toast(error instanceof Error ? error.message : "添加节点失败", true);
		} finally {
			setBusy(false);
		}
	};
	const remove = (id: string, name: string) => {
		removeNode(id, client);
		toast(`已移除 ${name}`);
	};
	return (
		<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="settings-nodes">
			<h2 className="mb-2 flex items-center gap-2 text-body font-medium">
				<span className="size-2 rounded-full bg-online" aria-hidden />
				节点
			</h2>
			<ul className="flex flex-col gap-1">
				{rows.map((row) => (
					<li key={row.id} className="flex items-center gap-2 rounded-control py-1.5">
						<button
							type="button"
							aria-pressed={row.current}
							onClick={() => setActiveNode(row.id)}
							className={cn(
								"press min-w-0 flex-1 rounded-control px-2 py-1.5 text-left",
								row.current ? "bg-tone" : "hover:bg-tone",
							)}
						>
							<span className="block truncate text-small">{row.name}</span>
							<span className="block truncate text-caption text-faint">{row.origin}</span>
						</button>
						{row.removable && (
							<button
								type="button"
								aria-label={`移除 ${row.name}`}
								onClick={() => remove(row.id, row.name)}
								className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-tone hover:text-danger"
							>
								<Trash2 size={15} aria-hidden />
							</button>
						)}
					</li>
				))}
			</ul>
			{adding ? (
				<div className="mt-3 flex flex-col gap-2">
					<Field
						label="节点地址"
						placeholder="https://host:7690/console"
						inputMode="url"
						autoComplete="off"
						value={origin}
						onChange={(e) => setOrigin(e.target.value)}
					/>
					<Field
						label="访问令牌（可选）"
						passwordToggle
						autoComplete="off"
						value={token}
						onChange={(e) => setToken(e.target.value)}
					/>
					<div className="flex gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => void submit()}
							className="press rounded-full bg-accent px-4 py-1.5 text-small text-on-accent disabled:opacity-40"
						>
							{busy ? "正在连接…" : "连接"}
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => setAdding(false)}
							className="press rounded-full bg-tone px-4 py-1.5 text-small text-ink disabled:opacity-40"
						>
							取消
						</button>
					</div>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setAdding(true)}
					className="press mt-2 flex items-center gap-1.5 rounded-control py-1.5 text-small text-muted hover:text-ink"
				>
					<Plus size={15} aria-hidden /> 添加节点
				</button>
			)}
			<p className="mt-2 text-caption text-faint">节点只保存地址；连接状态与查询缓存按节点分开。</p>
		</section>
	);
}
