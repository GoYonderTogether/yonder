import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import { Checkbox } from "radix-ui";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { entityRef } from "../lib/entityRef";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { Window } from "../ui/Window";

/** 桌面「发起群聊」小窗口：左选联系人，右看已选。 */
export function GroupWindow({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const nav = useNavigate();
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [q, setQ] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const { data: all = [] } = useQuery({ queryKey: ["contacts"], queryFn: api.contacts, enabled: open });
	const shown = all.filter((a) => a.name.includes(q.trim()));
	const chosen = picked.flatMap((id) => all.find((a) => a.id === id) ?? []);
	const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
	const close = () => {
		onOpenChange(false);
		setQ("");
		setPicked([]);
	};
	const create = async () => {
		setBusy(true);
		try {
			const title = chosen
				.slice(0, 3)
				.map((a) => a.name)
				.join("、");
			const c = await api.createGroup({ title, memberIds: picked });
			void qc.invalidateQueries({ queryKey: ["convs"] });
			close();
			nav(`/c/${entityRef(c)}`);
		} catch (error) {
			toast(error instanceof Error ? error.message : "建群失败", true);
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
							value={q}
							onChange={(e) => setQ(e.target.value)}
							placeholder="搜索"
							className="min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-faint"
						/>
					</label>
					<ul className="scroll-y min-h-0 flex-1">
						{shown.map((a) => (
							<li key={a.id}>
								{/* biome-ignore lint/a11y/noLabelWithoutControl: label 包住 Radix Checkbox（button 角色），点击整行即切换 */}
								<label className="press flex cursor-pointer items-center gap-3 rounded-control px-2 py-2 hover:bg-tone/60">
									<Checkbox.Root
										checked={picked.includes(a.id)}
										onCheckedChange={() => toggle(a.id)}
										className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-tone-2 data-[state=checked]:bg-accent data-[state=checked]:text-on-accent"
									>
										<Checkbox.Indicator>
											<Check size={12} strokeWidth={3} />
										</Checkbox.Indicator>
									</Checkbox.Root>
									<Avatar actor={a} size={32} />
									<span className="min-w-0 flex-1 truncate text-small">{a.name}</span>
								</label>
							</li>
						))}
						{!shown.length && <li className="px-2 py-6 text-small text-faint">没有匹配的联系人。</li>}
					</ul>
				</div>
				<div className="flex w-full min-w-0 flex-col bg-list p-3 lg:w-1/2">
					<p className="px-2 pt-1 pb-2 text-small text-muted">已选 {chosen.length} 人</p>
					<ul className="scroll-y hidden min-h-0 flex-1 lg:block">
						{chosen.map((a) => (
							<li key={a.id} className="flex items-center gap-3 rounded-control px-2 py-2">
								<Avatar actor={a} size={32} />
								<span className="min-w-0 flex-1 truncate text-small">{a.name}</span>
								<button
									type="button"
									aria-label={`移除 ${a.name}`}
									onClick={() => toggle(a.id)}
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
						<Button variant="primary" disabled={!chosen.length || busy} onClick={create}>
							完成
						</Button>
					</div>
				</div>
			</div>
		</Window>
	);
}
