import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { rpc } from "../api/client";
import { useActiveNode } from "../api/nodes";
import type { SessionOptions as Options, RuntimeChoice } from "../api/session-options";
import { footerStats } from "../api/session-state";
import { NewTask } from "../features/work/NewTask";
import { footerSegments } from "../lib/format";
import type { SessionView } from "../lib/useSession";
import { useWorkOnline } from "../lib/workOnline";
import { RuntimePicker, SessionOptions } from "./SessionOptions";

export function Footer({ v }: { v: SessionView }) {
	const node = useActiveNode();
	const online = useWorkOnline();
	const session = v.session;
	const id = session?.id;
	const editable = !!session && !session.closed;
	const task = session?.mode === "task";
	const [newTask, setNewTask] = useState<RuntimeChoice>();
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const qc = useQueryClient();
	const key = ["session-options", node.id, id];
	const options = useQuery({
		queryKey: key,
		enabled: !!id && online,
		retry: false,
		refetchInterval: 5000,
		queryFn: ({ signal }) => rpc<Options & { running: boolean }>("sessions.options.get", { id }, signal, node),
	});
	const seg = footerSegments(footerStats(v));
	const model = v.model;
	const value: Options = options.data ?? {
		model: model ? `${model.provider}/${model.model}` : undefined,
		effort: model?.thinking,
	};
	const change = async (patch: Partial<Options>) => {
		if (!id || !editable || saving) return;
		setSaving(true);
		setError("");
		try {
			qc.setQueryData(key, await rpc<Options>("sessions.options.set", { id, ...patch }, undefined, node));
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "设置失败");
		} finally {
			setSaving(false);
		}
	};
	return (
		<footer className="bg-ground px-3 pb-2" data-testid="footer">
			<div className="mx-auto max-w-[900px]">
				<SessionOptions
					session={id}
					node={node}
					value={value}
					onChange={(patch) => void change(patch)}
					disabled={!online || !editable || saving || !options.data}
					resourcesDisabled={v.running}
					runtime={<RuntimePicker value={{ ...node, online, workProtocol: 1 }} existing onChange={setNewTask} />}
				/>
				{session && !task && !session.closed && (
					<button
						type="button"
						className="press min-h-10 text-caption text-accent-ink"
						onClick={() => setNewTask(node)}
					>
						为此 Bot 创建工作任务
					</button>
				)}
				{(error || options.error) && (
					<p role="alert" className="text-caption text-danger">
						{error || options.error?.message}
					</p>
				)}
				{v.running && <p className="text-caption text-faint">请等待本次运行结束后修改工作区与权限。</p>}
				<div className="flex flex-wrap gap-x-3 text-[11px] text-faint tabular-nums">
					{seg.usage && <span>{seg.usage}</span>}
					{seg.children && <span>{seg.children}</span>}
					{seg.context && <span>{seg.context}</span>}
					{seg.lsp && <span>{seg.lsp}</span>}
				</div>
			</div>
			{newTask && (
				<NewTask
					initial={newTask}
					parent={id}
					agent={session?.agent ?? undefined}
					onClose={() => setNewTask(undefined)}
				/>
			)}
		</footer>
	);
}
