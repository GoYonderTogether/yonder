import { Loader, Pin } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { rpc } from "../api/client";
import type { TranscriptItem } from "../api/types";
import { archiveSession, pinSession, renameSession, unarchiveSession, unpinSession } from "../api/work";
import { titleOf } from "../lib/identity";
import { taskRowMenu } from "../lib/menus";
import { useTail } from "../lib/queries";
import { type MenuAnchor, useMenuTrigger } from "../lib/useLongPress";
import type { TaskStatus, WorkSession } from "../lib/work";
import { useWorkOnline } from "../lib/workOnline";
import { workPath } from "../shell/workRoutes";
import { ActionMenu } from "./ActionMenu";
import { toast } from "./kit/Toast";

const fail = (e: unknown, fallback: string) => toast(e instanceof Error ? e.message : fallback, true);

/** 行菜单的真实动作：重命名（§13）、置顶/归档（§18）、分出（sessions.fork）；后端拒绝时如实 toast。 */
function useRowActions(s: WorkSession, title: string, pinned: boolean, archived: boolean) {
	const navigate = useNavigate();
	const rename = async () => {
		const next = prompt("重命名任务", title)?.trim();
		if (!next || next === title) return;
		try {
			await renameSession(s.id, next.slice(0, 80));
		} catch (e) {
			fail(e, "重命名失败");
		}
	};
	const pin = async () => {
		try {
			await (pinned ? unpinSession(s.id) : pinSession(s.id));
		} catch (e) {
			fail(e, "置顶失败");
		}
	};
	const archive = async () => {
		try {
			await (archived ? unarchiveSession(s.id) : archiveSession(s.id));
		} catch (e) {
			fail(e, archived ? "恢复失败" : "归档失败");
		}
	};
	const fork = async () => {
		try {
			const page = await rpc<{ items: TranscriptItem[] }>("sessions.transcript", { id: s.id, limit: 1 });
			const at = Number(page.items.at(-1)?.id ?? 0);
			const child = await rpc<{ id: string }>("sessions.fork", { id: s.id, at });
			navigate(workPath({ session: child.id }));
		} catch (e) {
			fail(e, "分出失败");
		}
	};
	return { rename, pin, archive, fork };
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
	const online = useWorkOnline();
	const navigate = useNavigate();
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	const trigger = useMenuTrigger(setMenu);
	const title = titleOf(s);
	const isPinned = s.pinned ?? pinned ?? false;
	const { rename, pin, archive, fork } = useRowActions(s, title, isPinned, archived);
	const actions = taskRowMenu({
		session: s,
		pinned: isPinned,
		archived,
		open: () => navigate(workPath({ session: s.id })),
		rename: () => void rename(),
		pin: () => void pin(),
		fork: () => void fork(),
		archive: () => void archive(),
	});
	return (
		<>
			<Link
				to={workPath({ session: s.id })}
				{...trigger}
				title={title}
				aria-current={active ? "page" : undefined}
				className={`press no-select flex items-center gap-2 px-4 py-2 hover:bg-tone/60 ${active ? "bg-tone" : ""}`}
				data-testid="task-row"
			>
				<span className="flex w-4 shrink-0 items-center justify-center" data-testid="session-icon-slot">
					{status === "running" ? (
						<Loader size={13} className="animate-spin text-online" aria-label="进行中" />
					) : status === "waiting" ? (
						<span role="img" aria-label="需要你" className="size-2 rounded-full bg-accent" />
					) : isPinned ? (
						<Pin size={11} className="text-faint" aria-label="已置顶" />
					) : null}
				</span>
				<span className="min-w-0 flex-1">
					<span className={`flex items-center gap-1 text-small ${status === "done" ? "text-muted" : ""}`}>
						<span className="truncate">{title}</span>
					</span>
					{isPinned && <Progress id={s.id} />}
					{status === "waiting" && s.needsOwner && (
						<span className="block truncate text-caption text-faint">{s.needsOwner.reason}</span>
					)}
				</span>
			</Link>
			{menu && <ActionMenu at={menu} title={title} actions={online ? actions : actions.filter((action) => action.key === "open")} onClose={() => setMenu(null)} />}
		</>
	);
}
