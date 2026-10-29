import { Bot, ChevronRight, Terminal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { BackgroundRow, SubtaskRow } from "../api/types";
import { workPath } from "../shell/workRoutes";

const SUB_STATE: Record<SubtaskRow["state"], string> = {
	running: "进行中",
	waiting: "等待中",
	done: "已完成",
	error: "出错",
	aborted: "已中止",
};

function Card({
	icon: Icon,
	title,
	state,
	children,
	tid,
}: {
	icon: typeof Bot;
	title: string;
	state: string;
	children?: React.ReactNode;
	tid: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<div
			className="mx-auto w-full max-w-[720px] rounded-card border border-hairline bg-raised text-small"
			data-testid={tid}
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="press flex w-full items-center gap-2 px-3 py-2 text-left"
			>
				<ChevronRight
					size={14}
					className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
					aria-hidden
				/>
				<Icon size={14} className="shrink-0 text-muted" aria-hidden />
				<span className="min-w-0 flex-1 truncate">{title}</span>
				<span className="shrink-0 text-caption text-faint">{state}</span>
			</button>
			{open && <div className="border-t border-hairline px-3 py-2 text-caption text-muted">{children}</div>}
		</div>
	);
}

/** 子 Agent / 后台任务只作为对话里的可展开卡片，不进侧边栏（WORK-UX 第三轮 4）。 */
export function WorkCards({ subtasks, background }: { subtasks: SubtaskRow[]; background: BackgroundRow[] }) {
	if (subtasks.length + background.length === 0) return null;
	return (
		<>
			{subtasks.map((t) => (
				<Card key={t.id} icon={Bot} title={t.label} state={SUB_STATE[t.state]} tid="subagent-card">
					<Link to={workPath({ session: t.session })} className="underline">
						打开这个子 Bot 的对话
					</Link>
				</Card>
			))}
			{background.map((b) => (
				<Card
					key={b.id}
					icon={Terminal}
					title={b.label}
					state={b.state === "running" ? "运行中" : b.exitCode ? `退出 ${b.exitCode}` : "已结束"}
					tid="background-card"
				>
					自 {b.startedAt.slice(11, 16)} 开始
				</Card>
			))}
		</>
	);
}
