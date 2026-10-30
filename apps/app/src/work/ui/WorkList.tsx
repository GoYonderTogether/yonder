import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, MonitorSmartphone, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { rpc } from "../api/client";
import { useActiveNode, useNodes } from "../api/nodes";
import type { SessionInfo } from "../api/types";
import { workSessions } from "../api/work";
import { useActivity, useTitleOf } from "../lib/queries";
import {
	groupWork,
	isOpen,
	type TaskStatus,
	TIME_ORDER,
	TIME_TITLE,
	toggleFolds,
	useFolds,
	type WorkSession,
} from "../lib/work";
import { workPath } from "../shell/workRoutes";
import { Avatar } from "./Avatar";
import { DragScroll } from "./DragScroll";
import { toast } from "./kit/Toast";
import { TaskRow } from "./WorkRows";

/** 进行中最多直接显示的条数，其余折叠到「展开其余」。 */
const RUNNING_SHOWN = 5;

/** 控制台入口：节点切换、远程打开与添加设备都在 /work/console（FE-R02 / O27）。 */
function ConsoleEntry() {
	const nodes = useNodes();
	const active = useActiveNode();
	const name = active.name || active.id;
	if (active.deviceId)
		return (
			<div className="mx-4 mt-2 flex items-center gap-2 rounded-card bg-raised px-3 py-2" data-testid="current-device">
				<MonitorSmartphone size={17} className="shrink-0 text-muted" aria-hidden />
				<span className="min-w-0">
					<span className="block text-small">当前设备</span>
					<span className="block truncate text-caption text-faint">{name}</span>
				</span>
			</div>
		);
	const summary = nodes.length > 1 ? `${name} · ${nodes.length} 个节点` : "只控制本机";
	return (
		<Link
			to={workPath({ page: "console" })}
			className="press mx-4 mt-2 flex items-center gap-2 rounded-card bg-raised px-3 py-2"
			data-testid="console-entry"
		>
			<MonitorSmartphone size={17} className="shrink-0 text-muted" aria-hidden />
			<span className="min-w-0 flex-1">
				<span className="block text-small">控制台</span>
				<span className="block truncate text-caption text-faint">{summary}</span>
			</span>
			<ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />
		</Link>
	);
}

/** Bot 头像一排：只有 ≥2 个 Bot 才出现；点头像 = 进入该 Bot 主对话（不是筛选）。 */
function BotStrip({ bots, active, running }: { bots: WorkSession[]; active?: string; running: Set<string> }) {
	const titleOf = useTitleOf();
	if (bots.length < 2) return null;
	return (
		<DragScroll>
			{bots.map((s) => (
				<Link
					key={s.id}
					to={workPath({ session: s.id })}
					title={titleOf(s)}
					aria-current={s.id === active ? "page" : undefined}
					className={`press flex w-14 shrink-0 flex-col items-center gap-1 rounded-card py-1 ${s.id === active ? "bg-tone" : ""}`}
					data-testid="bot-avatar"
				>
					<Avatar seed={s.agent ?? s.id} group="bot" size={36} dot={running.has(s.id)} />
					<span className="w-full truncate text-center text-caption text-muted">{titleOf(s)}</span>
				</Link>
			))}
		</DragScroll>
	);
}

const Heading = ({ title }: { title: string }) => <h2 className="px-4 pt-3 pb-1 text-caption text-faint">{title}</h2>;

/**
 * 「工作」侧边栏（WORK-UX 第三轮）：新建任务、Bot 头像一排、需要你、进行中、置顶、
 * 今天/昨天/更早、已完成（折叠）。不显示设备卡片、类型标签、编号、轮次、数字。
 */
export function WorkList({ active }: { active?: string }) {
	const navigate = useNavigate();
	const sessions = useQuery({ queryKey: ["sessions", "work"], queryFn: workSessions, refetchInterval: 5000 });
	const activity = useActivity();
	const qc = useQueryClient();
	const folds = useFolds();
	const [opening, setOpening] = useState(false);

	const state = useMemo(() => new Map(activity.data?.sessions.map((x) => [x.id, x])), [activity.data]);
	const g = useMemo(() => groupWork((sessions.data ?? []) as WorkSession[], state), [sessions.data, state]);
	const runningBots = useMemo(
		() => new Set(g.bots.filter((s) => state.get(s.id)?.state === "running").map((s) => s.id)),
		[g.bots, state],
	);

	const openTask = async () => {
		setOpening(true);
		try {
			const s = await rpc<SessionInfo>("sessions.open", { preset: "default", close: "manual" });
			await qc.invalidateQueries({ queryKey: ["sessions"] });
			navigate(workPath({ session: s.id }));
		} catch (e) {
			toast(e instanceof Error ? e.message : "新建失败", true);
		} finally {
			setOpening(false);
		}
	};
	const row = (s: WorkSession, status: TaskStatus, pinned = false) => (
		<TaskRow key={s.id} s={s} active={s.id === active} status={status} pinned={pinned} archived={status === "done"} />
	);
	const moreOpen = isOpen(folds, "runningMore");
	const doneOpen = isOpen(folds, "done");
	const shownRunning = moreOpen ? g.running : g.running.slice(0, RUNNING_SHOWN);
	const empty =
		sessions.data &&
		g.needsYou.length + g.running.length + g.pinned.length + g.done.length === 0 &&
		TIME_ORDER.every((k) => g.byTime[k].length === 0);

	return (
		<div className="scroll-y h-full" data-testid="work-list">
			<div className="px-4 pt-1">
				<button
					type="button"
					onClick={() => void openTask()}
					disabled={opening}
					className="press flex w-full items-center gap-2 rounded-control bg-tone px-3 py-2 text-small disabled:opacity-40"
					data-testid="new-task"
				>
					<Plus size={16} aria-hidden /> 新任务
				</button>
			</div>
			<BotStrip bots={g.bots} active={active} running={runningBots} />
			<ConsoleEntry />
			{sessions.isLoading && <p className="px-4 py-2 text-small text-faint">加载中…</p>}
			{sessions.isError && <p className="px-4 py-2 text-small text-danger">会话加载失败，稍后自动重试。</p>}
			{empty && <p className="px-4 py-3 text-caption text-faint">还没有任务。点「新任务」开始。</p>}

			{g.needsYou.length > 0 && (
				<section data-testid="group-needs-you">
					<Heading title="需要你" />
					{g.needsYou.map((s) => row(s, "waiting"))}
				</section>
			)}
			{g.running.length > 0 && (
				<section data-testid="group-running">
					<Heading title="进行中" />
					{shownRunning.map((s) => row(s, "running"))}
					{g.running.length > RUNNING_SHOWN && (
						<button
							type="button"
							onClick={() => toggleFolds("runningMore")}
							className="press px-4 py-1.5 text-caption text-muted"
							data-testid="running-more"
						>
							{moreOpen ? "收起" : "展开其余"}
						</button>
					)}
				</section>
			)}
			{g.pinned.length > 0 && (
				<section data-testid="group-pinned">
					<Heading title="长期任务" />
					{g.pinned.map((s) => row(s, "idle", true))}
				</section>
			)}
			{TIME_ORDER.filter((k) => g.byTime[k].length > 0).map((k) => (
				<section key={k} data-testid={`group-${k}`}>
					<Heading title={TIME_TITLE[k]} />
					{g.byTime[k].map((s) => row(s, "idle"))}
				</section>
			))}
			{g.done.length > 0 && (
				<section data-testid="group-done" data-open={doneOpen}>
					<button
						type="button"
						onClick={() => toggleFolds("done")}
						aria-expanded={doneOpen}
						className="press mt-2 flex w-full items-center gap-1.5 px-4 py-1.5 text-caption text-faint"
					>
						{doneOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
						已完成
					</button>
					{doneOpen && g.done.map((s) => row(s, "done"))}
				</section>
			)}
		</div>
	);
}
