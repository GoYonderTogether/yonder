import { useQueryClient } from "@tanstack/react-query";
import { Loader, Pin } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { rpc } from "../api/client";
import type { TranscriptItem } from "../api/types";
import { titleOf } from "../lib/identity";
import { taskRowMenu } from "../lib/menus";
import { movePin, toggleArchive, usePrefs } from "../lib/prefs";
import { useTail } from "../lib/queries";
import { type MenuAnchor, useMenuTrigger } from "../lib/useLongPress";
import type { TaskStatus, WorkSession } from "../lib/work";
import { workPath } from "../shell/workRoutes";
import { ActionMenu } from "./ActionMenu";
import { toast } from "./kit/Toast";

const fail = (e: unknown, fallback: string) => toast(e instanceof Error ? e.message : fallback, true);

/** 行菜单的真实动作：重命名（§13 sessions.rename）、分出（sessions.fork）；后端拒绝时如实 toast。 */
function useRowActions(s: WorkSession, title: string) {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const refresh = () => qc.invalidateQueries({ queryKey: ["sessions"] });
	const rename = async () => {
		const next = prompt("重命名任务", title)?.trim();
		if (!next || next === title) return;
		try {
			await rpc("sessions.rename", { id: s.id, title: next.slice(0, 80) });
			await refresh();
		} catch (e) {
			fail(e, "重命名失败");
		}
	};
	const fork = async () => {
		try {
			const page = await rpc<{ items: TranscriptItem[] }>("sessions.transcript", { id: s.id, limit: 1 });
			const at = Number(page.items.at(-1)?.id ?? 0);
			const child = await rpc<{ id: string }>("sessions.fork", { id: s.id, at });
			await refresh();
			navigate(workPath({ session: child.id }));
		} catch (e) {
			fail(e, "分出失败");
		}
	};
	return { rename, fork };
}

/** 置顶行第二行：该任务最新一条助手回复的第一行；没有就不显示，不造进度。 */
function Progress({ id }: { id: string }) {
	const tail = useTail(id, "pin");
	const line = tail.data
		?.filter((i) => i.role === "assistant" && i.text.trim())
		.at(-1)
		?.text.trim()
		.split("\n")[0];
	return line ? <span className="block truncate text-caption text-faint">{line}</span> : null;
}

export function TaskRow({
	s,
	active,
	status,
	pinned,
	archived,
}: {
	s: WorkSession;
	active: boolean;
	status: TaskStatus;
	pinned?: boolean;
	archived: boolean;
}) {
	const navigate = useNavigate();
	const prefs = usePrefs();
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	const [over, setOver] = useState(false);
	const trigger = useMenuTrigger(setMenu);
	const title = titleOf(s);
	const { rename, fork } = useRowActions(s, title);
	const actions = taskRowMenu({
		session: s,
		pinned: prefs.pinned.includes(s.id),
		archived,
		open: () => navigate(workPath({ session: s.id })),
		rename: () => void rename(),
		fork: () => void fork(),
		archive: () => toggleArchive(s.id),
	});
	// 拖动排序只在置顶区
	const drag = pinned
		? {
				draggable: true,
				onDragStart: (e: React.DragEvent) => e.dataTransfer.setData("text/plain", s.id),
				onDragOver: (e: React.DragEvent) => {
					e.preventDefault();
					setOver(true);
				},
				onDragLeave: () => setOver(false),
				onDrop: (e: React.DragEvent) => {
					e.preventDefault();
					setOver(false);
					movePin(e.dataTransfer.getData("text/plain"), s.id);
				},
			}
		: {};
	return (
		<>
			<Link
				to={workPath({ session: s.id })}
				{...trigger}
				{...drag}
				title={title}
				aria-current={active ? "page" : undefined}
				className={`press no-select flex items-center gap-2 px-4 py-2 hover:bg-tone/60 ${active ? "bg-tone" : ""} ${over ? "border-t-2 border-accent" : ""}`}
				data-testid="task-row"
			>
				{status === "running" && <Loader size={13} className="shrink-0 animate-spin text-online" aria-label="进行中" />}
				{status === "waiting" && (
					<span role="img" aria-label="需要你" className="size-2 shrink-0 rounded-full bg-accent" />
				)}
				<span className="min-w-0 flex-1">
					<span className={`flex items-center gap-1 text-small ${status === "done" ? "text-muted" : ""}`}>
						{pinned && <Pin size={11} className="shrink-0 text-faint" aria-hidden />}
						<span className="truncate">{title}</span>
					</span>
					{pinned && <Progress id={s.id} />}
					{status === "waiting" && s.needsOwner && (
						<span className="block truncate text-caption text-faint">{s.needsOwner.reason}</span>
					)}
				</span>
			</Link>
			{menu && <ActionMenu at={menu} title={title} actions={actions} onClose={() => setMenu(null)} />}
		</>
	);
}
