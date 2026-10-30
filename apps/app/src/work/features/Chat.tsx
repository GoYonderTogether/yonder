import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Layers, PanelLeftOpen, PanelRight, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../../api";
import type { Actor } from "../../api/types";
import { Avatar } from "../../ui/Avatar";
import { RpcError, rpc } from "../api/client";
import { useActiveNode } from "../api/nodes";
import { useBranchLabel } from "../lib/branch";
import { isImported } from "../lib/identity";
import { IMPORT_PREFIX } from "../lib/imports";
import { FLOATABLE, PANEL_TITLE, toggleFloat, useLayout } from "../lib/layout";
import { deviceAgentMap, useDeviceAgents, useTitleOf } from "../lib/queries";
import { emptyView, type LiveView, type SessionView } from "../lib/useSession";
import { workPath } from "../shell/workRoutes";
import { ChannelPanel } from "../ui/ChannelPanel";
import { Composer } from "../ui/Composer";
import { FloatLayer } from "../ui/FloatLayer";
import { Footer } from "../ui/Footer";
import { CardStack, RightRail } from "../ui/RailStack";
import { Transcript } from "../ui/Transcript";
import { WorkCards } from "../ui/WorkCards";
import { ImportBody, useImport } from "./ImportView";
import { SessionSources } from "./SessionSources";

/** 悬浮窗开关菜单：勾选 = 该面板现在是悬浮窗 */
function FloatMenu({ session }: { session: string }) {
	const [open, setOpen] = useState(false);
	const layout = useLayout(session);
	return (
		<div className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-label="悬浮窗"
				aria-expanded={open}
				title="悬浮窗"
				className="press grid size-9 place-items-center rounded-full"
				data-testid="float-menu"
			>
				<Layers size={19} aria-hidden />
			</button>
			{open && (
				<div
					className="absolute right-0 z-30 mt-1 w-44 rounded-card bg-raised p-1 shadow-float"
					role="menu"
					data-testid="float-menu-list"
				>
					{FLOATABLE.map((k) => {
						const on = layout.float.some((f) => f.kind === k);
						return (
							<button
								key={k}
								type="button"
								role="menuitemcheckbox"
								aria-checked={on}
								onClick={() => {
									toggleFloat(session, k);
									setOpen(false);
								}}
								className="press flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-small hover:bg-tone"
							>
								<span className="w-4 text-center">{on ? "✓" : ""}</span>
								{PANEL_TITLE[k]}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

function Header({
	title,
	actor,
	summary,
	sub,
	wide,
	session,
	onRail,
	onList,
	railOpen,
	onChannels,
}: {
	title: string;
	actor?: Actor;
	summary?: string | null;
	sub?: string;
	wide: boolean;
	session: string;
	onRail(): void;
	onList?(): void;
	railOpen: boolean;
	onChannels?(): void;
}) {
	return (
		<header className="pt-safe flex items-center gap-1 border-b border-hairline bg-ground/90 px-2 py-2 backdrop-blur">
			{!wide && (
				<Link to={workPath()} aria-label="返回" className="press grid size-9 place-items-center rounded-full">
					<ChevronLeft size={22} aria-hidden />
				</Link>
			)}
			{onList && (
				<button
					type="button"
					aria-label="展开工作列表"
					onClick={onList}
					className="press grid size-9 place-items-center rounded-full"
				>
					<PanelLeftOpen size={19} aria-hidden />
				</button>
			)}
			{actor && <Avatar actor={actor} size={32} />}
			<div className={`min-w-0 flex-1 ${wide ? "px-2" : "text-center"}`}>
				<h1 className="truncate text-body font-semibold">{title}</h1>
				{summary && <p className="truncate text-caption text-faint">{summary}</p>}
				{sub && (
					<p title={sub} className="truncate text-caption text-faint">
						{sub}
					</p>
				)}
			</div>
			{onChannels && (
				<button
					type="button"
					onClick={onChannels}
					aria-label="渠道与子会话"
					title="渠道与子会话"
					className="press grid size-9 place-items-center rounded-full"
					data-testid="open-channels"
				>
					<Radio size={19} aria-hidden />
				</button>
			)}
			<FloatMenu session={session} />
			<button
				type="button"
				onClick={onRail}
				aria-label={railOpen ? "收起右栏" : "展开右栏"}
				aria-pressed={railOpen}
				className="press grid size-9 place-items-center rounded-full"
				data-testid="open-rail"
			>
				<PanelRight size={19} aria-hidden />
			</button>
		</header>
	);
}

/** 窄屏上右栏作为全屏抽屉：Esc 关闭，打开时焦点落到返回按钮。 */
function RailSheet({ children, onClose }: { children: React.ReactNode; onClose(): void }) {
	const close = useRef<HTMLButtonElement>(null);
	// onClose 每次渲染都是新函数；用 ref 取最新值，效果只在挂载时跑一次，避免每次会话事件都把焦点抢回返回键。
	const latest = useRef(onClose);
	latest.current = onClose;
	useEffect(() => {
		close.current?.focus();
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") latest.current();
		};
		addEventListener("keydown", key);
		return () => removeEventListener("keydown", key);
	}, []);
	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-list" role="dialog" aria-modal="true" aria-label="待办与任务">
			<header className="pt-safe flex items-center border-b border-hairline px-2 py-2">
				<button
					type="button"
					ref={close}
					onClick={onClose}
					aria-label="返回"
					className="press grid size-9 place-items-center rounded-full"
				>
					<ChevronLeft size={22} aria-hidden />
				</button>
				<h1 className="flex-1 text-center text-body font-semibold">待办与任务</h1>
				<span className="size-9" />
			</header>
			<div className="min-h-0 flex-1">{children}</div>
		</div>
	);
}

/**
 * 会话不存在：sessions.show 报 not_found 才算，其他失败（离线、权限、网关报错）沿用原有提示。
 * 只查一次，id 变化才重查；判成不存在后不再等 sessions.watch 的重连。
 */
function useMissingSession(id: string): boolean {
	const [missing, setMissing] = useState(false);
	useEffect(() => {
		const ctl = new AbortController();
		setMissing(false);
		rpc("sessions.show", { id, include: "meta" }, ctl.signal).catch((e: unknown) => {
			if (!ctl.signal.aborted && e instanceof RpcError && e.code === "not_found") setMissing(true);
		});
		return () => ctl.abort();
	}, [id]);
	return missing;
}

/** 找不到会话：用户语言的说明 + 回到列表的入口，不显示「正在重试」，也没有输入框。 */
function Missing({ wide }: { wide: boolean }) {
	return (
		<section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ground" aria-label="会话">
			<header className="pt-safe flex items-center gap-1 border-b border-hairline bg-ground/90 px-2 py-2">
				{!wide && (
					<Link to={workPath()} aria-label="返回" className="press grid size-9 place-items-center rounded-full">
						<ChevronLeft size={22} aria-hidden />
					</Link>
				)}
				<h1 className="min-w-0 flex-1 truncate text-center text-body font-semibold">会话</h1>
				{!wide && <span className="size-9" />}
			</header>
			<div
				role="alert"
				data-testid="session-missing"
				className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
			>
				<p className="text-body font-semibold">找不到这个会话</p>
				<p className="text-small text-faint">它可能已被删除或归档，链接也可能已经过期。</p>
				<Link to={workPath()} className="press rounded-control bg-tone px-4 py-2 text-small underline">
					回到会话列表
				</Link>
			</div>
		</section>
	);
}

function Live({
	id,
	wide,
	v,
	showRail,
	onRail,
	onList,
}: {
	id: string;
	wide: boolean;
	v: LiveView;
	showRail: boolean;
	onRail(): void;
	onList?(): void;
}) {
	const [sourcesOpen, setSourcesOpen] = useState(false);
	const [channels, setChannels] = useState(false);
	const titleOf = useTitleOf();
	const node = useActiveNode();
	const agents = useDeviceAgents();
	const s = v.session;
	const isBot = s?.mode === "main" && !!s.agent && !isImported(s);
	const actor =
		s?.agent && (s.mode === "main" || s.mode === "persistent") && node.deviceId
			? deviceAgentMap(node.deviceId, agents.data ?? []).get(s.agent)
			: undefined;
	const profile = useQuery({
		queryKey: ["bot-profile", node.id, actor?.id],
		enabled: !!actor,
		queryFn: () => api.profile(actor!.id),
		refetchInterval: 5000,
	});
	const branch = useBranchLabel(s);
	const sub =
		[s?.mode === "persistent" ? branch : undefined, v.running ? "正在回复…" : s?.closed ? "已结束" : undefined]
			.filter(Boolean)
			.join(" · ") || undefined;
	const missing = useMissingSession(id);
	if (missing) return <Missing wide={wide} />;
	return (
		<>
			<section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ground" aria-label="聊天">
				<Header
					title={s ? titleOf(s) : "会话"}
					actor={actor}
					summary={profile.data?.summary ?? actor?.summary}
					sub={sub}
					wide={wide}
					session={id}
					onRail={onRail}
					onList={onList}
					railOpen={showRail}
					onChannels={isBot ? () => setChannels((o) => !o) : undefined}
				/>
				{v.error && (
					<p role="alert" className="bg-danger/10 px-4 py-1.5 text-caption text-danger">
						{v.error}
					</p>
				)}
				<details className="border-b border-hairline" onToggle={(event) => setSourcesOpen(event.currentTarget.open)}>
					<summary className="cursor-pointer px-4 py-2 text-small text-muted">来源与路由</summary>
					{sourcesOpen && <SessionSources session={id} agent={s?.agent ?? undefined} />}
				</details>
				{!v.ready ? (
					<p className="flex-1 py-16 text-center text-small text-faint">连接中…</p>
				) : (
					<Transcript items={v.items} hasMore={v.hasMore} onOlder={v.loadOlder}>
						<WorkCards subtasks={v.subtasks} background={v.background} />
					</Transcript>
				)}
				{s?.closed ? (
					<p className="border-t border-hairline px-4 py-3 text-center text-small text-faint">会话已结束</p>
				) : (
					<Composer
						session={id}
						running={v.running}
						bot={s?.mode === "main" && s.agent && !isImported(s) ? s.agent : undefined}
					/>
				)}
				<Footer v={v} />
				<FloatLayer session={id} v={v} />
			</section>
			{channels && s?.agent && <ChannelPanel bot={s.agent} wide={wide} onClose={() => setChannels(false)} />}
			{wide && !channels && showRail ? (
				<RightRail session={id} v={v} />
			) : (
				!wide &&
				showRail && (
					<RailSheet onClose={onRail}>
						<CardStack session={id} v={v} />
					</RailSheet>
				)
			)}
		</>
	);
}

function Imported({
	id,
	wide,
	showRail,
	onRail,
	onList,
}: {
	id: string;
	wide: boolean;
	showRail: boolean;
	onRail(): void;
	onList?(): void;
}) {
	const q = useImport(id);
	const d = q.data;
	const key = `${IMPORT_PREFIX}${id}`;
	const v: SessionView = { ...emptyView, ready: true, todos: d?.todo?.items ?? [] };
	return (
		<>
			<section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ground" aria-label="导入的会话">
				<Header
					title={d?.summary.title || "导入的 pi 会话"}
					sub={d?.summary.cwd}
					wide={wide}
					session={key}
					onRail={onRail}
					onList={onList}
					railOpen={showRail}
				/>
				<ImportBody id={id} />
				<FloatLayer session={key} v={v} />
			</section>
			{wide && showRail ? (
				<RightRail session={key} v={v} />
			) : (
				!wide &&
				showRail && (
					<RailSheet onClose={onRail}>
						<CardStack session={key} v={v} />
					</RailSheet>
				)
			)}
		</>
	);
}

export function Chat({
	id,
	wide,
	v,
	showRail,
	onRail,
	onList,
}: {
	id: string;
	wide: boolean;
	v: LiveView;
	showRail: boolean;
	onRail(): void;
	onList?(): void;
}) {
	return id.startsWith(IMPORT_PREFIX) ? (
		<Imported
			key={id}
			id={id.slice(IMPORT_PREFIX.length)}
			wide={wide}
			showRail={showRail}
			onRail={onRail}
			onList={onList}
		/>
	) : (
		<Live key={id} id={id} wide={wide} v={v} showRail={showRail} onRail={onRail} onList={onList} />
	);
}
