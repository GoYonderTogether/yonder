import { ChevronLeft, PanelRight } from "lucide-react";
import { useState } from "react";
import { titleOf } from "../lib/identity";
import { IMPORT_PREFIX } from "../lib/imports";
import { useSession } from "../lib/useSession";
import { Composer } from "../ui/Composer";
import { Footer } from "../ui/Footer";
import { Rail } from "../ui/Rail";
import { Transcript } from "../ui/Transcript";
import { ImportBody, useImport } from "./ImportView";

function Header({ title, sub, wide, onRail }: { title: string; sub?: string; wide: boolean; onRail(): void }) {
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
			{!wide && (
				<button
					type="button"
					onClick={onRail}
					aria-label="待办与任务"
					className="press grid size-9 place-items-center rounded-full"
					data-testid="open-rail"
				>
					<PanelRight size={19} aria-hidden />
				</button>
			)}
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

function Live({ id, wide }: { id: string; wide: boolean }) {
	const v = useSession(id);
	const [rail, setRail] = useState(false);
	const s = v.session;
	const sub = v.running ? "正在回复…" : s?.closed ? "已结束" : s ? `${s.profile} · ${s.mode}` : undefined;
	const rightRail = <Rail v={v} session={id} />;
	return (
		<>
			<section className="flex min-h-0 min-w-0 flex-1 flex-col bg-ground" aria-label="聊天">
				<Header title={s ? titleOf(s) : "会话"} sub={sub} wide={wide} onRail={() => setRail(true)} />
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
					<Composer session={id} running={v.running} />
				)}
				<Footer v={v} />
			</section>
			{wide ? (
				<aside className="w-[300px] shrink-0 border-l border-hairline">{rightRail}</aside>
			) : (
				rail && <RailSheet onClose={() => setRail(false)}>{rightRail}</RailSheet>
			)}
		</>
	);
}

function Imported({ id, wide }: { id: string; wide: boolean }) {
	const q = useImport(id);
	const [rail, setRail] = useState(false);
	const d = q.data;
	const rightRail = <Rail v={{ todos: d?.todo?.items ?? [], subtasks: [], background: [] }} todoOnly />;
	return (
		<>
			<section className="flex min-h-0 min-w-0 flex-1 flex-col bg-ground" aria-label="导入的会话">
				<Header
					title={d?.summary.title || "导入的 pi 会话"}
					sub={d?.summary.cwd}
					wide={wide}
					onRail={() => setRail(true)}
				/>
				<ImportBody id={id} />
			</section>
			{wide ? (
				<aside className="w-[300px] shrink-0 border-l border-hairline">{rightRail}</aside>
			) : (
				rail && <RailSheet onClose={() => setRail(false)}>{rightRail}</RailSheet>
			)}
		</>
	);
}

export function Chat({ id, wide }: { id: string; wide: boolean }) {
	return id.startsWith(IMPORT_PREFIX) ? (
		<Imported key={id} id={id.slice(IMPORT_PREFIX.length)} wide={wide} />
	) : (
		<Live key={id} id={id} wide={wide} />
	);
}
