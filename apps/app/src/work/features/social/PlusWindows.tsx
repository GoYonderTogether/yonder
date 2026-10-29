import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import { useState } from "react";
import { httpApi } from "../../api/social";
import { href } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { toast } from "../../ui/kit/Toast";
import { Window } from "../../ui/kit/Window";
import { SocialAvatar } from "./IdentityAvatar";

/** 桌面「发起群聊」小窗口：左选联系人、右看已选。与名片站 PlusWindows.GroupWindow 同一版式。 */
export function GroupWindow({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const [q, setQ] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const qc = useQueryClient();
	const contacts = useQuery({ queryKey: ["contacts"], queryFn: httpApi.contacts, enabled: open });
	const all = contacts.data ?? [];
	const shown = all.filter((actor) => actor.name.includes(q.trim()));
	const chosen = picked.flatMap((id) => all.find((actor) => actor.id === id) ?? []);
	const toggle = (id: string) => setPicked((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
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
		<Window
			open={open}
			onOpenChange={(v) => (v ? onOpenChange(v) : close())}
			title="发起群聊"
			className="h-[min(460px,85dvh)] w-[min(640px,calc(100vw-1.5rem))]"
		>
			<div className="flex min-h-0 flex-1 flex-col lg:flex-row">
				<div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2 p-3 lg:w-1/2">
					<label className="field flex h-9 items-center gap-2 rounded-control bg-tone px-3 text-faint">
						<Search size={15} />
						<input
							aria-label="搜索联系人"
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="搜索"
							className="min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-faint"
						/>
					</label>
					{contacts.isPending ? (
						<p role="status" className="px-2 py-6 text-small text-faint">
							正在加载联系人…
						</p>
					) : contacts.isError ? (
						<p role="alert" className="px-2 py-6 text-small text-faint">
							加载联系人失败
						</p>
					) : (
						<ul className="scroll-y min-h-0 flex-1">
							{shown.map((actor) => {
								const on = picked.includes(actor.id);
								return (
									<li key={actor.id}>
										<button
											type="button"
											onClick={() => toggle(actor.id)}
											className="press flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-tone/60"
										>
											<span
												className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${on ? "bg-accent text-on-accent" : "bg-tone-2"}`}
											>
												{on && <Check size={12} strokeWidth={3} />}
											</span>
											<SocialAvatar actor={actor} size={32} />
											<span className="min-w-0 flex-1 truncate text-small">{actor.name}</span>
										</button>
									</li>
								);
							})}
							{!shown.length && <li className="px-2 py-6 text-small text-faint">没有匹配的联系人。</li>}
						</ul>
					)}
				</div>
				<div className="flex w-full min-w-0 flex-col bg-list p-3 lg:w-1/2">
					<p className="px-2 pt-1 pb-2 text-[13px] text-muted">已选 {chosen.length} 人</p>
					<ul className="scroll-y hidden min-h-0 flex-1 lg:block">
						{chosen.map((actor) => (
							<li key={actor.id} className="flex items-center gap-3 rounded-control px-2 py-2">
								<SocialAvatar actor={actor} size={32} />
								<span className="min-w-0 flex-1 truncate text-small">{actor.name}</span>
								<button
									type="button"
									aria-label={`移除 ${actor.name}`}
									onClick={() => toggle(actor.id)}
									className="press rounded-full p-1.5 text-faint hover:bg-tone hover:text-ink"
								>
									<X size={14} />
								</button>
							</li>
						))}
					</ul>
					<div className="flex justify-end gap-2 pt-3">
						<Button variant="ghost" onClick={close}>
							取消
						</Button>
						<Button variant="primary" disabled={!chosen.length || busy} onClick={() => void create()}>
							完成
						</Button>
					</div>
				</div>
			</div>
		</Window>
	);
}
