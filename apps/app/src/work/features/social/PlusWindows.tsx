import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { httpApi } from "../../api/social";
import { href } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { Field } from "../../ui/kit/Field";
import { toast } from "../../ui/kit/Toast";
import { Window } from "../../ui/kit/Window";

export function GroupWindow({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const [q, setQ] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const qc = useQueryClient();
	const contacts = useQuery({ queryKey: ["contacts"], queryFn: httpApi.contacts, enabled: open });
	const chosen = (contacts.data ?? []).filter((actor) => picked.includes(actor.id));
	const close = () => {
		onOpenChange(false);
		setQ("");
		setPicked([]);
	};
	const create = async () => {
		setBusy(true);
		try {
			const conversation = await httpApi.createGroup({
				title: chosen
					.slice(0, 3)
					.map((actor) => actor.name)
					.join("、"),
				memberIds: picked,
			});
			void qc.invalidateQueries({ queryKey: ["convs"] });
			close();
			location.hash = href({ tab: "chats", page: "c", session: conversation.code ?? conversation.id });
		} catch {
			toast("建群失败", true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Window open={open} onOpenChange={(v) => (v ? onOpenChange(v) : close())} title="发起群聊">
			<div className="flex flex-col gap-3 p-4">
				<Field label="搜索联系人" value={q} onChange={(e) => setQ(e.target.value)} />
				{contacts.isPending ? (
					<p role="status">正在加载联系人…</p>
				) : contacts.isError ? (
					<p role="alert">加载联系人失败</p>
				) : (
					<ul className="max-h-60 overflow-y-auto">
						{contacts.data
							.filter((actor) => actor.name.includes(q.trim()))
							.map((actor) => (
								<li key={actor.id}>
									<label className="flex items-center gap-3 p-2">
										<input
											type="checkbox"
											checked={picked.includes(actor.id)}
											onChange={() =>
												setPicked((old) =>
													old.includes(actor.id) ? old.filter((id) => id !== actor.id) : [...old, actor.id],
												)
											}
										/>
										{actor.name}
									</label>
								</li>
							))}
					</ul>
				)}
				<p>已选 {chosen.length} 人</p>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={close}>
						取消
					</Button>
					<Button variant="primary" disabled={!chosen.length || busy} onClick={() => void create()}>
						完成
					</Button>
				</div>
			</div>
		</Window>
	);
}
