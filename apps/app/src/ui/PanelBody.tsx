import { Check, CircleDashed, Loader } from "lucide-react";
import type { TodoItem } from "../api/types";
import { tokens } from "../lib/format";
import { titleOf } from "../lib/identity";
import type { PanelKind } from "../lib/layout";
import { useSessions } from "../lib/queries";
import type { SessionView } from "../lib/useSession";

const Empty = ({ t, need }: { t: string; need?: string }) => (
	<p className="text-caption text-faint">
		{t}
		{need && <span className="block font-mono">需要 {need}</span>}
	</p>
);

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
};

function Subtasks({ v, session }: { v: SessionView; session: string }) {
	const all = useSessions();
	// subtask.updated 到位前，用 sessions.list 里 parent 指向本会话的子会话（真实数据）
	const kids = (all.data ?? []).filter((s) => s.parent === session);
	if (v.subtasks.length)
		return (
			<ul className="flex flex-col gap-1">
				{v.subtasks.map((r) => (
					<li key={r.id} className="flex items-center gap-2 text-small">
						<a
							href={`#/s/${encodeURIComponent(r.session)}`}
							className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
						>
							{r.label}
						</a>
						<span className="shrink-0 text-caption text-faint">{STATE[r.state] ?? r.state}</span>
					</li>
				))}
			</ul>
		);
	if (kids.length)
		return (
			<ul className="flex flex-col gap-1">
				{kids.map((s) => (
					<li key={s.id} className="flex items-center gap-2 text-small">
						<a
							href={`#/s/${encodeURIComponent(s.id)}`}
							className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
						>
							{titleOf(s)}
						</a>
						<span className="shrink-0 text-caption text-faint">{s.closed ? "已结束" : "进行中"}</span>
					</li>
				))}
			</ul>
		);
	return <Empty t="没有委派的子 Agent" />;
}

function Context({ v }: { v: SessionView }) {
	const c = v.context;
	const u = v.usage?.self;
	const win = c?.window ?? v.model?.contextWindow;
	if (!c && !u && !win) return <Empty t="上下文用量还没有上报" need="context.updated" />;
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

/** 面板正文：右栏卡片与悬浮窗共用，不分放置。缺数据一律诚实空态并标明缺哪个契约项。 */
export function PanelBody({ kind, v, session }: { kind: PanelKind; v: SessionView; session: string }) {
	switch (kind) {
		case "todos":
			return v.todos.length ? <TodoTree items={v.todos} /> : <Empty t="暂无待办" need="todo.updated" />;
		case "goal":
			return <Empty t="当前节点没有 goal 接口" need="goal 读取方法（契约未定义）" />;
		case "subtasks":
			return <Subtasks v={v} session={session} />;
		case "attachments":
			return <Empty t="这个会话没有可列出的附件" need="attachments 列表方法（契约仅有 attachments.put）" />;
		case "views":
			return <Empty t="没有插件贡献的视图" need="views.list" />;
		case "context":
			return <Context v={v} />;
		case "background":
			return v.background.length ? (
				<ul className="flex flex-col gap-1">
					{v.background.map((r) => (
						<li key={r.id} className="flex items-center gap-2 text-small">
							<span className="min-w-0 flex-1 truncate font-mono text-caption">{r.label}</span>
							<span className="shrink-0 text-caption text-faint">
								{r.state === "running" ? "运行中" : `已退出 ${r.exitCode ?? ""}`}
							</span>
						</li>
					))}
				</ul>
			) : (
				<Empty t="没有后台任务" need="background.updated" />
			);
		case "wake":
			return <Empty t="暂无 Bot 唤醒记录" need="events.query（awake 事件）" />;
	}
}

/** 标签/角标上的计数；没有数据时不显示 */
export function countOf(kind: PanelKind, v: SessionView): string | undefined {
	switch (kind) {
		case "todos":
			return v.todos.length ? `${v.todos.filter((t) => t.state === "done").length}/${v.todos.length}` : undefined;
		case "subtasks":
			return v.subtasks.length ? String(v.subtasks.length) : undefined;
		case "background":
			return v.background.length ? String(v.background.length) : undefined;
		case "context":
			return v.context ? `${Math.round(v.context.percent)}%` : undefined;
		default:
			return undefined;
	}
}
