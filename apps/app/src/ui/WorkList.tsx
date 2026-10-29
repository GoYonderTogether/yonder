import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { rpc } from "../api/client";
import type { SessionInfo } from "../api/types";
import { badge } from "../lib/format";
import { titleOf } from "../lib/identity";
import { markRead, usePrefs } from "../lib/prefs";
import { useActivity, useSessions, useTail, useTitleOf } from "../lib/queries";
import { href } from "../lib/useHash";
import type { SessionView } from "../lib/useSession";
import {
	groupWork,
	isOpen,
	progressOf,
	STATUS_TITLE,
	TASK_ORDER,
	type TaskStatus,
	toggleFolds,
	useFolds,
} from "../lib/work";
import { Avatar } from "./Avatar";

const num = (id: string) => Number(id.replace(/\D/g, ""));

function BotRow({ s, active, running }: { s: SessionInfo; active: boolean; running: boolean }) {
	const prefs = usePrefs();
	const title = useTitleOf()(s);
	const tail = useTail(s.id, running ? "run" : "idle");
	const items = tail.data ?? [];
	const lastId = items.reduce((m, i) => Math.max(m, num(i.id)), 0);
	const readTo = prefs.read[s.id];
	const unread = active ? 0 : items.filter((i) => i.role !== "user" && num(i.id) > (readTo ?? lastId)).length;
	useEffect(() => {
		if (active && lastId > 0) markRead(s.id, lastId);
	}, [active, lastId, s.id]);
	return (
		<a
			href={href({ tab: "work", session: s.id })}
			aria-current={active ? "page" : undefined}
			className={`press flex items-center gap-2.5 px-4 py-2 hover:bg-tone/60 ${active ? "bg-tone" : ""}`}
			data-testid="bot-row"
		>
			<Avatar seed={s.agent ?? s.id} group="bot" size={32} dot={running} />
			<span className="min-w-0 flex-1 truncate text-small font-medium">{title}</span>
			<span className="text-caption text-faint">{running ? "运行中" : "待命"}</span>
			{unread > 0 && (
				<span
					role="img"
					className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-caption leading-none text-white"
					aria-label={`${unread} 条未读`}
				>
					{badge(unread)}
				</span>
			)}
		</a>
	);
}

function TaskRow({
	s,
	active,
	status,
	since,
	v,
}: {
	s: SessionInfo;
	active: boolean;
	status: TaskStatus;
	since?: string;
	v?: SessionView;
}) {
	// 只有当前打开的任务有逐条进度（todo/子任务来自它的 sessions.watch）；其余行不伪造
	const todo = v?.todos.length ? `${v.todos.filter((t) => t.state === "done").length}/${v.todos.length}` : undefined;
	const subs = v?.subtasks.length;
	return (
		<a
			href={href({ tab: "work", session: s.id })}
			aria-current={active ? "page" : undefined}
			className={`press flex items-center gap-2 px-4 py-2 pl-7 hover:bg-tone/60 ${active ? "bg-tone" : ""}`}
			data-testid="task-row"
		>
			{status === "running" && <Loader size={13} className="shrink-0 animate-spin text-online" aria-label="运行中" />}
			<span className={`min-w-0 flex-1 truncate text-small ${status === "done" ? "text-muted" : ""}`}>
				{titleOf(s)}
			</span>
			{todo && <span className="shrink-0 font-mono text-caption text-muted">待办 {todo}</span>}
			{subs ? <span className="shrink-0 text-caption text-muted">{subs} 子任务</span> : null}
			{status === "running" && !todo && since && (
				<span className="shrink-0 text-caption text-faint">自 {since.slice(11, 16)}</span>
			)}
		</a>
	);
}

function Group({
	testId,
	title,
	rows,
	open,
	onToggle,
	children,
}: {
	testId: string;
	title: string;
	rows?: number;
	open: boolean;
	onToggle(): void;
	children: React.ReactNode;
}) {
	return (
		<section data-testid={testId} data-open={open}>
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={open}
				className="press flex w-full items-center gap-1.5 px-4 py-1.5 text-caption text-faint"
			>
				{open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
				{title}
				{rows !== undefined && <span className="ml-auto font-mono">{rows}</span>}
			</button>
			{open && children}
		</section>
	);
}

/** 工作模式第二列：上半 Bot（常驻 Agent），下半任务会话按状态分组。 */
export function WorkList({ active, view }: { active?: string; view?: SessionView }) {
	const sessions = useSessions();
	const activity = useActivity();
	const qc = useQueryClient();
	// 折叠状态（Bot 区与四个任务分组）由 lib/work 持久化，已完成默认收起
	const folds = useFolds();
	const [opening, setOpening] = useState(false);

	const state = useMemo(() => new Map(activity.data?.sessions.map((x) => [x.id, x])), [activity.data]);
	const { bots, byStatus } = useMemo(() => groupWork(sessions.data ?? [], state), [sessions.data, state]);

	const { total, done } = progressOf(byStatus);
	const openTask = async () => {
		setOpening(true);
		try {
			const s = await rpc<SessionInfo>("sessions.open", { preset: "default", close: "manual" });
			await qc.invalidateQueries({ queryKey: ["sessions"] });
			location.hash = href({ tab: "work", session: s.id });
		} catch (e) {
			alert(e instanceof Error ? e.message : "新建失败");
		} finally {
			setOpening(false);
		}
	};

	return (
		<div className="scroll-y h-full" data-testid="work-list">
			<div className="pt-2">
				{sessions.isLoading && <p className="px-4 py-2 text-small text-faint">加载中…</p>}
				{sessions.isError && <p className="px-4 py-2 text-small text-danger">会话加载失败，稍后自动重试。</p>}
				<Group testId="bot-group" title="Bot" open={isOpen(folds, "bot")} onToggle={() => toggleFolds("bot")}>
					{sessions.data && bots.length === 0 && <p className="px-4 py-2 text-caption text-faint">没有常驻 Bot</p>}
					{bots.map((s) => (
						<BotRow key={s.id} s={s} active={s.id === active} running={state.get(s.id)?.state === "running"} />
					))}
				</Group>
			</div>

			<div className="mt-2 flex items-center gap-2 border-t border-hairline px-4 pt-3 pb-1">
				<h2 className="text-caption text-faint">任务</h2>
				{total > 0 && (
					<span className="flex items-center gap-1.5 text-caption text-faint" data-testid="task-progress">
						<span className="h-1 w-14 overflow-hidden rounded-full bg-tone">
							<span className="block h-full bg-online" style={{ width: `${(done / total) * 100}%` }} />
						</span>
						{done}/{total}
					</span>
				)}
				<button
					type="button"
					onClick={() => void openTask()}
					disabled={opening}
					aria-label="新建任务"
					title="新建任务"
					className="press ml-auto grid size-7 place-items-center rounded-full bg-tone disabled:opacity-40"
					data-testid="new-task"
				>
					<Plus size={15} aria-hidden />
				</button>
			</div>
			{sessions.data && total === 0 && <p className="px-4 py-2 text-caption text-faint">还没有任务会话</p>}
			{TASK_ORDER.filter((k) => byStatus[k].length > 0).map((k) => (
				<Group
					key={k}
					testId={`task-group-${k}`}
					title={STATUS_TITLE[k]}
					rows={byStatus[k].length}
					open={isOpen(folds, k)}
					onToggle={() => toggleFolds(k)}
				>
					{byStatus[k].map((s) => (
						<TaskRow
							key={s.id}
							s={s}
							active={s.id === active}
							status={k}
							since={state.get(s.id)?.since}
							v={s.id === active ? view : undefined}
						/>
					))}
				</Group>
			))}
		</div>
	);
}
