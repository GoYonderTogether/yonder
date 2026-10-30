import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDashed, Loader } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router";
import { rpc } from "../api/client";
import { mux } from "../api/stream";
import type { TodoItem } from "../api/types";
import { ViewHost } from "../features/views/ViewHost";
import { tokens } from "../lib/format";
import { titleOf } from "../lib/identity";
import type { PanelKind } from "../lib/layout";
import { useSessions } from "../lib/queries";
import { useRailAttachments } from "../lib/railContent";
import type { SessionView } from "../lib/useSession";
import { workPath } from "../shell/workRoutes";

export const Empty = ({ t }: { t: string }) => <p className="text-caption text-faint">{t}</p>;

function Attachments({ session }: { session: string }) {
	const attachments = useRailAttachments(session);
	if (attachments.isPending) return <Empty t="正在读取附件" />;
	if (attachments.isError) return <Empty t="附件读取失败" />;
	if (!attachments.data?.length) return <Empty t="这个会话最近 50 条消息没有附件" />;
	return (
		<ul>
			{[...new Map(attachments.data.map((item) => [item.uri, item])).values()].map((item) => (
				<li key={item.uri} className="truncate text-small">
					{item.name || item.kind}
				</li>
			))}
		</ul>
	);
}

function TodoRow({ item, depth }: { item: TodoItem; depth: number }) {
	const done = item.state === "done";
	return (
		<li className="flex items-start gap-2 py-0.5 text-small" style={{ paddingLeft: depth * 16 }}>
			<span className="mt-1 shrink-0 text-muted">
				{done ? (
					<Check size={14} aria-label="已完成" />
				) : item.state === "doing" ? (
					<Loader size={14} className="animate-spin" aria-label="进行中" />
				) : (
					<CircleDashed size={14} aria-label={item.state === "cancelled" ? "已取消" : "待办"} />
				)}
			</span>
			<span className={done || item.state === "cancelled" ? "text-faint line-through" : ""}>{item.text}</span>
		</li>
	);
}

export function TodoTree({ items }: { items: TodoItem[] }) {
	const shown = [...items].sort((a, b) => a.order - b.order).slice(0, 10);
	const walk = (p: string | undefined, depth: number): React.ReactNode =>
		shown
			.filter((i) => i.parent === p)
			.map((i) => (
				<div key={i.id}>
					<TodoRow item={i} depth={depth} />
					{walk(i.id, depth + 1)}
				</div>
			));
	return (
		<ul>
			{walk(undefined, 0)}
			{items.length > 10 && <li className="pt-1 text-caption text-faint">+{items.length - 10} 项</li>}
		</ul>
	);
}

const STATE: Record<string, string> = {
	running: "运行中",
	waiting: "等待",
	done: "完成",
	error: "出错",
	aborted: "已中止",
	completed: "完成",
	terminal: "已结束",
};

function Background({ session, placement }: { session: string; placement: "rail" | "floating" }) {
	const viewId = `core.background.${placement}`;
	const queryKey = ["background-view", session, placement];
	const qc = useQueryClient();
	const query = useQuery({
		queryKey,
		queryFn: () =>
			rpc<{ content: { type: "list"; items: { id: string; title: string; subtitle?: string }[] } }>("views.data", {
				viewId,
				session,
			}),
		retry: false,
	});
	useEffect(
		() =>
			mux.subscribe(
				"views.watch",
				{ session, placement },
				{
					onReady: () => {
						void qc.invalidateQueries({ queryKey: ["background-view", session, placement] });
					},
					onEvent: (_type, data) => {
						if ((data as { ids?: string[] }).ids?.includes(viewId))
							void qc.invalidateQueries({ queryKey: ["background-view", session, placement] });
					},
				},
			),
		[qc, session, placement, viewId],
	);
	if (query.isPending) return <Empty t="正在读取后台任务" />;
	if (query.isError) return <Empty t="后台任务读取失败" />;
	const items = query.data.content.items;
	if (!items.length) return <Empty t="没有后台任务" />;
	return (
		<ul className="flex flex-col gap-1">
			{items.map((item) => (
				<li key={item.id} className="flex items-center gap-2 text-small">
					<span className="min-w-0 flex-1 truncate font-mono text-caption">
						{item.title} · {item.id}
					</span>
					<span className="shrink-0 text-caption text-faint">{STATE[item.subtitle ?? ""] ?? item.subtitle}</span>
				</li>
			))}
		</ul>
	);
}

function Subtasks({ v, session }: { v: SessionView; session: string }) {
	const all = useSessions();
	// subtask.updated 到位前，用 sessions.list 里 parent 指向本会话的子会话（真实数据）
	const kids = (all.data ?? []).filter((s) => s.parent === session);
	const rows = v.subtasks.length
		? v.subtasks.map((row) => {
				const child = kids.find((item) => item.id === row.session);
				return {
					id: row.id,
					session: row.session,
					label: row.label,
					status: STATE[row.state] ?? row.state,
					done: ["done", "error", "aborted"].includes(row.state) || !!child?.closed || !!child?.archivedAt,
				};
			})
		: kids.map((child) => ({
				id: child.id,
				session: child.id,
				label: titleOf(child),
				status: child.closed || child.archivedAt ? "已结束" : "进行中",
				done: !!child.closed || !!child.archivedAt,
			}));
	if (!rows.length) return <Empty t="没有委派的子 Bot" />;
	const list = (items: typeof rows) => (
		<ul className="flex flex-col gap-1">
			{items.map((row) => (
				<li key={row.id} className="flex items-center gap-2 text-small">
					<Link
						to={workPath({ session: row.session })}
						className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
					>
						{row.label}
					</Link>
					<span className="shrink-0 text-caption text-faint">{row.status}</span>
				</li>
			))}
		</ul>
	);
	const active = rows.filter((row) => !row.done),
		done = rows.filter((row) => row.done);
	return (
		<>
			{list(active)}
			{done.length > 0 && (
				<details>
					<summary className="cursor-pointer py-1 text-caption text-muted">已完成（{done.length}）</summary>
					{list(done)}
				</details>
			)}
		</>
	);
}

function Context({ v }: { v: SessionView }) {
	const c = v.context;
	const u = v.usage?.self;
	const win = c?.window ?? v.model?.contextWindow;
	if (!c && !u && !win) return <Empty t="上下文用量还没有上报" />;
	const pct = c ? Math.min(100, c.percent) : 0;
	const tone = !c ? "bg-muted" : c.percent > 90 ? "bg-danger" : c.percent > 70 ? "bg-[#b7791f]" : "bg-accent";
	const rows: [string, number][] = u
		? [
				["输入", u.input],
				["输出", u.output],
				["缓存读", u.cacheRead],
				["缓存写", u.cacheWrite],
			]
		: [];
	return (
		<div className="text-small">
			{c ? (
				<>
					<p className="mb-1 flex items-baseline gap-2">
						<span className="text-title font-semibold">{c.percent.toFixed(1)}%</span>
						<span className="text-caption text-faint">
							{tokens(c.tokens)} / {tokens(c.window)}
							{c.auto ? " · 自动压缩" : ""}
						</span>
					</p>
					<div
						className="h-1.5 overflow-hidden rounded-full bg-tone"
						role="progressbar"
						aria-valuenow={Math.round(pct)}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label="上下文占用"
					>
						<div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
					</div>
				</>
			) : (
				win && <p className="text-caption text-faint">窗口 {tokens(win)}，当前占用还没有上报</p>
			)}
			{rows.length > 0 && (
				<dl className="mt-3 grid grid-cols-[5em_1fr] gap-y-0.5 text-caption">
					<dt className="col-span-2 mb-0.5 text-faint">累计用量（按类别）</dt>
					{rows.map(([k, n]) => (
						<div key={k} className="contents">
							<dt className="text-muted">{k}</dt>
							<dd className="font-mono">{tokens(n)}</dd>
						</div>
					))}
				</dl>
			)}
		</div>
	);
}

/** 面板正文：右栏卡片与悬浮窗共用，不分放置。缺数据用一句人话的空态。 */
export function PanelBody({
	kind,
	v,
	session,
	placement = "rail",
}: {
	kind: PanelKind;
	v: SessionView;
	session: string;
	placement?: "rail" | "floating";
}) {
	switch (kind) {
		case "todos":
			return v.todos.length ? <TodoTree items={v.todos} /> : <Empty t="暂无待办" />;
		case "goal":
			return v.goal ? <p className="text-small">{v.goal.text}</p> : <Empty t="还没有设定目标" />;
		case "subtasks":
			return <Subtasks v={v} session={session} />;
		case "attachments":
			return <Attachments session={session} />;
		case "views":
			return <ViewHost session={session} />;
		case "context":
			return <Context v={v} />;
		case "background":
			return <Background session={session} placement={placement} />;
		case "wake":
			return v.wakes?.length ? (
				<ul>
					{v.wakes.map((wake) => (
						<li key={wake.id} className="text-small">
							{wake.summary || wake.source}
						</li>
					))}
				</ul>
			) : (
				<Empty t="暂无 Bot 唤醒记录" />
			);
	}
}

/** 标签/角标上的计数；没有数据时不显示 */
export function countOf(kind: PanelKind, v: SessionView): string | undefined {
	switch (kind) {
		case "todos":
			return v.todos.length ? `${v.todos.filter((t) => t.state === "done").length}/${v.todos.length}` : undefined;
		case "subtasks":
			return v.subtasks.length ? String(v.subtasks.length) : undefined;
		case "context":
			return v.context ? `${Math.round(v.context.percent)}%` : undefined;
		default:
			return undefined;
	}
}
