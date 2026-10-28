import { ChevronLeft, Layers, PanelRight } from "lucide-react";
import { useState } from "react";
import { isImported } from "../lib/identity";
import { IMPORT_PREFIX } from "../lib/imports";
import { FLOATABLE, PANEL_TITLE, setRailPref, toggleFloat, useLayout, useRailPref } from "../lib/layout";
import { useTitleOf } from "../lib/queries";
import { emptyView, type LiveView, type SessionView } from "../lib/useSession";
import { Composer } from "../ui/Composer";
import { FloatLayer } from "../ui/FloatLayer";
import { Footer } from "../ui/Footer";
import { CardStack, RightRail } from "../ui/RailStack";
import { Transcript } from "../ui/Transcript";
import { ImportBody, useImport } from "./ImportView";

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
	sub,
	wide,
	session,
	onRail,
}: {
	title: string;
	sub?: string;
	wide: boolean;
	session: string;
	onRail(): void;
}) {
	const rail = useRailPref();
	return (
		<header className="pt-safe flex items-center gap-1 border-b border-hairline bg-ground/90 px-2 py-2 backdrop-blur">
			{!wide && (
				<a href="#/" aria-label="返回" className="press grid size-9 place-items-center rounded-full">
					<ChevronLeft size={22} aria-hidden />
				</a>
			)}
			<div className={`min-w-0 flex-1 ${wide ? "px-2" : "text-center"}`}>
				<h1 className="truncate text-body font-semibold">{title}</h1>
				{sub && <p className="truncate text-caption text-faint">{sub}</p>}
			</div>
			<FloatMenu session={session} />
			<button
				type="button"
				onClick={wide ? () => setRailPref({ open: !rail.open }) : onRail}
				aria-label={wide ? (rail.open ? "收起右栏" : "展开右栏") : "待办与任务"}
				aria-pressed={wide ? rail.open : undefined}
				className="press grid size-9 place-items-center rounded-full"
				data-testid="open-rail"
			>
				<PanelRight size={19} aria-hidden />
			</button>
		</header>
	);
}

/** 窄屏上右栏作为全屏层叠页 */
function RailSheet({ children, onClose }: { children: React.ReactNode; onClose(): void }) {
	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-list" role="dialog" aria-modal="true" aria-label="待办与任务">
			<header className="pt-safe flex items-center border-b border-hairline px-2 py-2">
				<button
					type="button"
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

function Live({ id, wide, v }: { id: string; wide: boolean; v: LiveView }) {
	const [rail, setRail] = useState(false);
	const titleOf = useTitleOf();
	const s = v.session;
	const sub = v.running ? "正在回复…" : s?.closed ? "已结束" : s ? `${s.profile} · ${s.mode}` : undefined;
	return (
		<>
			<section className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ground" aria-label="聊天">
				<Header title={s ? titleOf(s) : "会话"} sub={sub} wide={wide} session={id} onRail={() => setRail(true)} />
				{v.error && (
					<p role="alert" className="bg-danger/10 px-4 py-1.5 text-caption text-danger">
						{v.error}
					</p>
				)}
				{!v.ready ? (
					<p className="flex-1 py-16 text-center text-small text-faint">连接中…</p>
				) : (
					<Transcript items={v.items} hasMore={v.hasMore} onOlder={v.loadOlder} />
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
			{wide ? (
				<RightRail session={id} v={v} />
			) : (
				rail && (
					<RailSheet onClose={() => setRail(false)}>
						<CardStack session={id} v={v} />
					</RailSheet>
				)
			)}
		</>
	);
}

function Imported({ id, wide }: { id: string; wide: boolean }) {
	const q = useImport(id);
	const [rail, setRail] = useState(false);
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
					onRail={() => setRail(true)}
				/>
				<ImportBody id={id} />
				<FloatLayer session={key} v={v} />
			</section>
			{wide ? (
				<RightRail session={key} v={v} />
			) : (
				rail && (
					<RailSheet onClose={() => setRail(false)}>
						<CardStack session={key} v={v} />
					</RailSheet>
				)
			)}
		</>
	);
}

export function Chat({ id, wide, v }: { id: string; wide: boolean; v: LiveView }) {
	return id.startsWith(IMPORT_PREFIX) ? (
		<Imported key={id} id={id.slice(IMPORT_PREFIX.length)} wide={wide} />
	) : (
		<Live key={id} id={id} wide={wide} v={v} />
	);
}
