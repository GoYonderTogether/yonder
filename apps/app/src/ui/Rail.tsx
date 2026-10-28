import { Check, CircleDashed, Loader, ShieldQuestion, SquareTerminal, Users } from "lucide-react";
import { useState } from "react";
import { useApprovals } from "../lib/queries";
import type { SessionView } from "../lib/useSession";
import { rpc } from "../transport/client";
import type { TodoItem } from "../transport/types";

function Section({
	icon: Icon,
	title,
	count,
	children,
	tid,
}: {
	icon: typeof Check;
	title: string;
	count?: string;
	children: React.ReactNode;
	tid: string;
}) {
	return (
		<section className="border-b border-hairline px-4 py-3" data-testid={tid}>
			<h3 className="mb-2 flex items-center gap-2 text-small font-medium">
				<Icon size={15} className="text-muted" aria-hidden />
				{title}
				{count && <span className="ml-auto text-caption font-normal text-faint">{count}</span>}
			</h3>
			{children}
		</section>
	);
}
const Empty = ({ t }: { t: string }) => <p className="text-caption text-faint">{t}</p>;

function Todo({ item, depth }: { item: TodoItem; depth: number }) {
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

function TodoTree({ items }: { items: TodoItem[] }) {
	const shown = [...items].sort((a, b) => a.order - b.order).slice(0, 10);
	const kids = (p?: string) => shown.filter((i) => i.parent === p);
	const walk = (p: string | undefined, depth: number): React.ReactNode =>
		kids(p).map((i) => (
			<div key={i.id}>
				<Todo item={i} depth={depth} />
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

function Approvals({ session }: { session?: string }) {
	const q = useApprovals();
	const [busy, setBusy] = useState("");
	const items = (q.data?.items ?? []).filter((a) => !session || !a.session || a.session === session);
	const answer = async (approvalId: string, decision: "approve" | "deny") => {
		setBusy(approvalId);
		try {
			await rpc("approvals.answer", { approvalId, decision });
		} finally {
			setBusy("");
			void q.refetch();
		}
	};
	if (q.isError) return <Empty t="当前节点未提供审批接口" />;
	if (items.length === 0) return <Empty t="没有在等你回答的事" />;
	return (
		<ul className="flex flex-col gap-2">
			{items.map((a) => (
				<li key={a.approvalId} className="rounded-control bg-tone p-2.5 text-small">
					<p>{a.reason ?? `请求使用 ${a.library}/${a.ref}`}</p>
					<p className="mt-0.5 font-mono text-caption text-faint">
						{a.ref} → {a.sink}
					</p>
					<div className="mt-2 flex gap-2">
						<button
							type="button"
							disabled={busy === a.approvalId}
							onClick={() => void answer(a.approvalId, "approve")}
							className="press rounded-full bg-accent px-3 py-1 text-caption text-on-accent"
						>
							同意
						</button>
						<button
							type="button"
							disabled={busy === a.approvalId}
							onClick={() => void answer(a.approvalId, "deny")}
							className="press rounded-full border border-hairline px-3 py-1 text-caption"
						>
							拒绝
						</button>
					</div>
				</li>
			))}
		</ul>
	);
}

/** 桌面右栏 / 手机详情页：todo 树、子任务、后台任务、等你回答 */
export function Rail({
	v,
	session,
	todoOnly,
}: {
	v: Pick<SessionView, "todos" | "subtasks" | "background">;
	session?: string;
	todoOnly?: boolean;
}) {
	const done = v.todos.filter((t) => t.state === "done").length;
	return (
		<div className="scroll-y h-full bg-list" data-testid="rail">
			<Section
				icon={Check}
				title="待办"
				count={v.todos.length ? `${done}/${v.todos.length}` : undefined}
				tid="rail-todo"
			>
				{v.todos.length ? <TodoTree items={v.todos} /> : <Empty t="暂无待办" />}
			</Section>
			{!todoOnly && (
				<>
					<Section icon={Users} title="子任务" tid="rail-subtasks">
						{v.subtasks.length ? (
							<ul className="flex flex-col gap-1">
								{v.subtasks.map((r) => (
									<li key={r.id} className="flex items-center gap-2 text-small">
										<a
											href={`#/s/${encodeURIComponent(r.session)}`}
											className="min-w-0 flex-1 truncate underline-offset-2 hover:underline"
										>
											{r.label}
										</a>
										<span className="shrink-0 text-caption text-faint">
											{{ running: "运行中", waiting: "等待", done: "完成", error: "出错", aborted: "已中止" }[
												r.state
											] ?? r.state}
										</span>
									</li>
								))}
							</ul>
						) : (
							<Empty t="没有委派的子任务" />
						)}
					</Section>
					<Section icon={SquareTerminal} title="后台任务" tid="rail-background">
						{v.background.length ? (
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
							<Empty t="没有后台任务" />
						)}
					</Section>
					<Section icon={ShieldQuestion} title="等你回答" tid="rail-approvals">
						<Approvals session={session} />
					</Section>
				</>
			)}
		</div>
	);
}
