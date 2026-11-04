import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { AppBar } from "../components/AppBar";
import { CreateBotEntry } from "../components/CreateBotEntry";
import { useNeedsBot } from "../lib/useOnboarding";
import { Button } from "../ui/Button";
import { RpcError, rpc } from "../work/api/client";
import { useActiveNode } from "../work/api/nodes";
import type { ActivitySummary } from "../work/api/types";
import { useTitleOf } from "../work/lib/queries";
import { taskStatus, type WorkSession } from "../work/lib/work";
import { useWorkOnline } from "../work/lib/workOnline";
import { workPath } from "../work/shell/workRoutes";

/** 定时作业（cron 插件的 cron.manage 视图，经 views.act 派发）。返回值是 JSON 文本，由这里解析。 */
interface CronJob {
	id: string;
	name: string;
	enabled: boolean;
	schedule: {
		kind: "at" | "every" | "cron";
		at?: string;
		milliseconds?: number;
		expression?: string;
		timezone: string;
	};
	payload: { kind: string; preset?: string; text?: string };
	next: number | null;
	runs: number;
	updated: string;
	created: string;
}

const cronManage = (input: Record<string, unknown>, signal?: AbortSignal) =>
	rpc<{ content?: { text?: string } }>("views.act", { viewId: "cron.manage", action: "manage", input }, signal).then(
		(result) => {
			if (!result.content?.text) throw new Error("定时作业接口没有返回结果");
			return JSON.parse(result.content.text) as unknown;
		},
	);

/** 作业计划的可读形式：at/every/cron 三种，字段缺了就不显示那一段，不编造。 */
function scheduleText(schedule: CronJob["schedule"]): string {
	const tz = schedule.timezone ? ` · ${schedule.timezone}` : "";
	if (schedule.kind === "at") return schedule.at ? `一次性 · ${new Date(schedule.at).toLocaleString()}${tz}` : "一次性";
	if (schedule.kind === "every")
		return schedule.milliseconds
			? `每 ${
					schedule.milliseconds >= 60_000 && schedule.milliseconds % 60_000 === 0
						? `${schedule.milliseconds / 60_000} 分钟`
						: `${schedule.milliseconds / 1000} 秒`
				}${tz}`
			: "固定间隔";
	return schedule.expression ? `Cron · ${schedule.expression}${tz}` : "Cron";
}

function errorText(error: unknown, fallback: string): string {
	if (error instanceof RpcError && error.code === "not_found") return "这个节点没有加载定时作业插件";
	return error instanceof Error ? error.message : fallback;
}

function nextText(next: number | null): string | undefined {
	if (typeof next !== "number") return undefined;
	const d = new Date(next);
	if (Number.isNaN(d.getTime())) return undefined;
	return `下次 ${d.toLocaleString()}`;
}

function Segmented({ tab, onTab }: { tab: "tasks" | "cron"; onTab: (t: "tasks" | "cron") => void }) {
	return (
		<div role="tablist" aria-label="任务分区" className="mx-4 flex gap-1 rounded-control bg-tone p-1">
			{(
				[
					["tasks", "任务"],
					["cron", "定时"],
				] as const
			).map(([key, label]) => (
				<button
					key={key}
					type="button"
					role="tab"
					aria-selected={tab === key}
					onClick={() => onTab(key)}
					className={`press min-h-9 flex-1 rounded-control text-small ${tab === key ? "bg-raised font-medium shadow-soft" : "text-muted"}`}
				>
					{label}
				</button>
			))}
		</div>
	);
}

function OfflineNotice() {
	return (
		<div className="mx-4 rounded-card bg-raised p-4 text-small text-muted" data-testid="tasks-offline">
			<p>当前运行位置不在线。</p>
			<p className="mt-2">
				去
				<Link to="/me/settings/runtimes" className="mx-1 text-accent-ink underline">
					运行位置
				</Link>
				选择或启动一个云端运行位置，或在
				<Link to="/connect" className="mx-1 text-accent-ink underline">
					设备
				</Link>
				连接一台电脑。
			</p>
		</div>
	);
}

/** 任务行：会话在活动节点上的真实状态；点击进入既有工作会话视图。 */
function TaskRowView({ s, state }: { s: WorkSession; state?: string }) {
	const titleOf = useTitleOf();
	const status = taskStatus(s, state as never);
	const title = titleOf(s);
	return (
		<Link
			to={workPath({ session: s.id })}
			title={title}
			className="press mx-2 flex items-center gap-2 rounded-control px-2 py-2 hover:bg-tone/70"
			data-testid="task-row"
		>
			<span className="flex w-4 shrink-0 items-center justify-center">
				{status === "running" ? (
					<Loader size={13} className="animate-spin text-online" aria-label="进行中" />
				) : status === "waiting" ? (
					<span role="img" aria-label="需要你" className="size-2 rounded-full bg-accent" />
				) : null}
			</span>
			<span className="min-w-0 flex-1">
				<span className={`flex items-center gap-1 text-small ${status === "done" ? "text-muted" : ""}`}>
					<span className="truncate">{title}</span>
				</span>
				{status === "waiting" && s.needsOwner && (
					<span className="block truncate text-caption text-faint">{s.needsOwner.reason}</span>
				)}
			</span>
		</Link>
	);
}

/** 任务列表：活动节点的全部任务会话（含已完成的归档会话）。 */
function TaskList() {
	const online = useWorkOnline();
	const sessions = useQuery({
		queryKey: ["sessions", "work"],
		queryFn: async () => {
			const [open, archived] = await Promise.all([
				rpc<WorkSession[]>("sessions.list", {}),
				rpc<WorkSession[]>("sessions.list", { filter: { archived: true } }),
			]);
			return [...open, ...archived];
		},
		enabled: online,
		refetchInterval: 5000,
		retry: false,
	});
	const activity = useQuery({
		queryKey: ["activity"],
		queryFn: () => rpc<ActivitySummary>("activity.summary"),
		enabled: online,
		refetchInterval: 2500,
		retry: false,
	});
	if (!online) return <OfflineNotice />;
	if (sessions.isPending) return <p className="px-4 py-2 text-small text-faint">加载中…</p>;
	if (sessions.isError)
		return (
			<p role="alert" className="px-4 py-2 text-small text-danger">
				{errorText(sessions.error, "任务加载失败")}
			</p>
		);
	const state = new Map(activity.data?.sessions.map((x) => [x.id, x.state]));
	const tasks = (sessions.data ?? []).filter(isTask);
	return (
		<div className="flex flex-col">
			{tasks.map((s) => (
				<TaskRowView key={s.id} s={s} state={state.get(s.id)} />
			))}
		</div>
	);
}

/** 任务过滤：任务会话（mode === "task"）就是列表的全部；Bot 主对话不在任务页里。 */
const isTask = (s: WorkSession) => s.mode === "task";

/** 定时作业行：真实开关、立即运行、删除（确认）。 */
function CronRow({ job }: { job: CronJob }) {
	const qc = useQueryClient();
	const [error, setError] = useState("");
	const [confirming, setConfirming] = useState(false);
	const act = useMutation({
		mutationFn: (input: Record<string, unknown>) => cronManage(input),
		onSuccess: () => {
			setError("");
			void qc.invalidateQueries({ queryKey: ["cron-jobs"] });
		},
		onError: (e) => setError(e instanceof Error ? e.message : "操作失败"),
	});
	const run = (input: Record<string, unknown>) => {
		if (!act.isPending) act.mutate(input);
	};
	return (
		<li className="border-t border-hairline/60 px-4 py-3 first:border-0" data-testid="cron-row">
			<div className="flex items-center gap-3">
				<div className="min-w-0 flex-1">
					<p className="truncate text-small font-medium">{job.name}</p>
					<p className="text-caption text-muted">{scheduleText(job.schedule)}</p>
					<p className="text-caption text-faint">
						{[job.enabled ? nextText(job.next) : "已停用", job.runs ? `已运行 ${job.runs} 次` : undefined]
							.filter(Boolean)
							.join(" · ") || undefined}
					</p>
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={job.enabled}
					aria-label={`${job.name} 启用`}
					disabled={act.isPending}
					onClick={() => run({ action: job.enabled ? "disable" : "enable", id: job.id })}
					className={`press relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${job.enabled ? "bg-accent" : "bg-tone-2"}`}
				>
					<span
						className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-raised shadow-sm transition-transform ${job.enabled ? "translate-x-4" : ""}`}
					/>
				</button>
			</div>
			<div className="mt-2 flex items-center gap-2">
				<Button
					size="sm"
					variant="secondary"
					disabled={act.isPending}
					onClick={() => run({ action: "run", id: job.id })}
				>
					立即运行
				</Button>
				{confirming ? (
					<>
						<Button
							size="sm"
							variant="primary"
							disabled={act.isPending}
							onClick={() => {
								run({ action: "delete", id: job.id });
								setConfirming(false);
							}}
						>
							确认删除
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
							取消
						</Button>
					</>
				) : (
					<Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => setConfirming(true)}>
						<Trash2 size={14} aria-hidden />
						删除
					</Button>
				)}
			</div>
			{error && (
				<p role="alert" className="mt-1 text-caption text-danger">
					{error}
				</p>
			)}
		</li>
	);
}

/** 新建定时作业：preset 用节点自己的 default 预设（与新建任务 sessions.open 相同），时区取浏览器的。 */
function CronCreate({ onDone }: { onDone: () => void }) {
	const qc = useQueryClient();
	const [name, setName] = useState("");
	const [expression, setExpression] = useState("");
	const [text, setText] = useState("");
	const [error, setError] = useState("");
	const create = useMutation({
		mutationFn: (input: Record<string, unknown>) => cronManage(input),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["cron-jobs"] });
			onDone();
		},
		onError: (e) => setError(e instanceof Error ? e.message : "创建失败"),
	});
	const submit = (event: FormEvent) => {
		event.preventDefault();
		setError("");
		const nameTrim = name.trim();
		const expressionTrim = expression.trim();
		if (!nameTrim || !expressionTrim) {
			setError("名称和 cron 表达式都要填");
			return;
		}
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		create.mutate({
			action: "create",
			job: {
				name: nameTrim,
				schedule: { kind: "cron", expression: expressionTrim, timezone },
				payload: { kind: "preset", preset: "default", text: text.trim() },
			},
		});
	};
	return (
		<form
			onSubmit={submit}
			className="mx-4 mt-3 flex flex-col gap-3 rounded-card bg-raised p-4"
			data-testid="cron-create"
		>
			<label className="flex flex-col gap-1 text-small">
				名称
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="field rounded-control bg-tone px-3 py-2"
					required
				/>
			</label>
			<label className="flex flex-col gap-1 text-small">
				Cron 表达式（5 或 6 个字段）
				<input
					value={expression}
					onChange={(e) => setExpression(e.target.value)}
					placeholder="0 9 * * *"
					className="field rounded-control bg-tone px-3 py-2"
					required
				/>
			</label>
			<label className="flex flex-col gap-1 text-small">
				让 Bot 做什么
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					className="field min-h-20 rounded-control bg-tone px-3 py-2"
				/>
			</label>
			{error && (
				<p role="alert" className="text-caption text-danger">
					{error}
				</p>
			)}
			<div className="flex gap-2">
				<Button type="submit" variant="primary" disabled={create.isPending}>
					创建
				</Button>
				<Button type="button" variant="ghost" onClick={onDone}>
					取消
				</Button>
			</div>
		</form>
	);
}

/** 定时分区：列表与新建。错误如实显示（含节点没装 cron 插件的真实报错）。 */
function CronList() {
	const node = useActiveNode();
	const online = useWorkOnline();
	const [creating, setCreating] = useState(false);
	const jobs = useQuery({
		queryKey: ["cron-jobs", node.id],
		queryFn: () => cronManage({ action: "list" }) as Promise<CronJob[]>,
		enabled: online,
		retry: false,
	});
	if (!online) return <OfflineNotice />;
	if (jobs.isPending) return <p className="px-4 py-2 text-small text-faint">加载中…</p>;
	if (jobs.isError)
		return (
			<p role="alert" className="mx-4 mt-3 text-small text-danger">
				{errorText(jobs.error, "定时作业加载失败")}
				<button type="button" className="ml-2 underline" onClick={() => void jobs.refetch()}>
					重试
				</button>
			</p>
		);
	const list = Array.isArray(jobs.data) ? jobs.data : [];
	return (
		<div className="flex flex-col">
			<div className="flex items-center justify-between px-4 pt-1">
				<h2 className="text-caption text-faint">定时作业</h2>
				<Button size="sm" variant="ghost" onClick={() => setCreating((v) => !v)} data-testid="cron-new">
					<Plus size={14} aria-hidden />
					新建
				</Button>
			</div>
			{creating && <CronCreate onDone={() => setCreating(false)} />}
			{!list.length && !creating && <p className="px-4 py-3 text-caption text-faint">还没有定时作业</p>}
			<ul className="mt-1">
				{list.map((job) => (
					<CronRow key={job.id} job={job} />
				))}
			</ul>
		</div>
	);
}

export function Tasks() {
	const [tab, setTab] = useState<"tasks" | "cron">("tasks");
	const needsBot = useNeedsBot();
	if (needsBot)
		return (
			<div className="scroll-y h-full bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-panel lg:shadow-soft">
				<div className="lg:hidden">
					<AppBar title="任务" />
				</div>
				<div className="flex h-full flex-col items-center justify-center gap-5 px-6 pb-24 text-center lg:pb-10">
					<p className="text-title font-semibold tracking-tight">还没有 Bot</p>
					<CreateBotEntry />
				</div>
			</div>
		);
	return (
		<div className="scroll-y h-full bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-panel lg:shadow-soft">
			<div className="lg:hidden">
				<AppBar title="任务" />
			</div>
			<div className="mx-auto flex max-w-3xl flex-col gap-3 pb-24 pt-3 lg:px-4 lg:pb-10">
				<Segmented tab={tab} onTab={setTab} />
				{tab === "tasks" ? <TaskList /> : <CronList />}
			</div>
		</div>
	);
}
