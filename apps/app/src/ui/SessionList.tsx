import { BellOff, BellRing, CheckCheck, Pin, PinOff, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ActionItem } from "../lib/actions";
import { previewOf } from "../lib/chat";
import { badge, clock } from "../lib/format";
import { GROUP_TITLE, type Group, groupOf, titleOf } from "../lib/identity";
import { type ImportSummary, importRoute } from "../lib/imports";
import { markRead, setLevel, togglePin, usePrefs } from "../lib/prefs";
import { useActivity, useImports, useSessions, useTail } from "../lib/queries";
import { href } from "../lib/useHash";
import { type MenuAnchor, useMenuTrigger } from "../lib/useLongPress";
import type { SessionInfo } from "../transport/types";
import { ActionMenu } from "./ActionMenu";
import { Avatar } from "./Avatar";

const num = (id: string) => Number(id.replace(/\D/g, ""));

function Row({ s, active, running }: { s: SessionInfo; active: boolean; running: boolean }) {
	const prefs = usePrefs();
	const tail = useTail(s.id, running ? "run" : "idle");
	const items = tail.data ?? [];
	const last = items[items.length - 1];
	const lastId = items.reduce((m, i) => Math.max(m, num(i.id)), 0);
	const level = prefs.level[s.id] ?? "all";
	const pinned = prefs.pinned.includes(s.id);
	const readTo = prefs.read[s.id];
	const [menu, setMenu] = useState<MenuAnchor | null>(null);

	// 首次见到的会话以当前最新位置为基线，不把历史全算未读
	useEffect(() => {
		if (readTo === undefined && lastId > 0) markRead(s.id, lastId);
	}, [readTo, lastId, s.id]);
	useEffect(() => {
		if (active && lastId > 0) markRead(s.id, lastId);
	}, [active, lastId, s.id]);

	const unread = active ? 0 : items.filter((i) => i.role !== "user" && num(i.id) > (readTo ?? lastId)).length;
	const trigger = useMenuTrigger(setMenu);
	const actions: ActionItem[] = [
		{ key: "pin", label: pinned ? "取消置顶" : "置顶", icon: pinned ? PinOff : Pin, onSelect: () => togglePin(s.id) },
		{
			key: "all",
			label: "免打扰：关闭",
			icon: BellRing,
			checked: level === "all",
			onSelect: () => setLevel(s.id, "all"),
		},
		{
			key: "mention",
			label: "免打扰：仅提问与审批",
			icon: BellRing,
			checked: level === "mention",
			onSelect: () => setLevel(s.id, "mention"),
		},
		{
			key: "mute",
			label: "免打扰：静音",
			icon: BellOff,
			checked: level === "mute",
			onSelect: () => setLevel(s.id, "mute"),
		},
		...(unread > 0
			? [{ key: "read", label: "标为已读", icon: CheckCheck, onSelect: () => markRead(s.id, lastId) }]
			: []),
	];

	return (
		<>
			<a
				href={href({ tab: "chats", session: s.id })}
				{...trigger}
				className={`press no-select flex items-center gap-3 px-4 py-3 hover:bg-tone/60 ${active ? "bg-tone" : pinned ? "bg-tone/40" : ""}`}
				aria-current={active ? "page" : undefined}
				data-testid="session-row"
			>
				<Avatar seed={s.agent ?? s.id} group={groupOf(s)} dot={running} />
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2">
						<span className="truncate text-body font-medium">{titleOf(s)}</span>
						{level === "mute" && <BellOff size={13} className="shrink-0 text-faint" aria-label="免打扰" />}
						<span className="ml-auto shrink-0 text-caption text-faint">
							{clock(running ? undefined : (s.closed ?? s.opened))}
						</span>
					</span>
					<span className="mt-0.5 flex items-center gap-2">
						<span className="truncate text-small text-muted">
							{running ? "正在回复…" : previewOf(last) || "暂无消息"}
						</span>
						{unread > 0 &&
							(level === "all" ? (
								<span
									role="img"
									className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-danger px-1 text-caption leading-none text-white"
									aria-label={`${unread} 条未读`}
								>
									{badge(unread)}
								</span>
							) : (
								<span
									className="ml-auto size-2.5 shrink-0 rounded-full bg-danger"
									role="img"
									aria-label={`${unread} 条未读（免打扰）`}
								/>
							))}
					</span>
				</span>
			</a>
			{menu && <ActionMenu at={menu} title={titleOf(s)} actions={actions} onClose={() => setMenu(null)} />}
		</>
	);
}

/** 导入的 pi 会话：只读，菜单只有置顶。 */
function ImportRow({ s, active }: { s: ImportSummary; active: boolean }) {
	const prefs = usePrefs();
	const key = importRoute(s.id);
	const pinned = prefs.pinned.includes(key);
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	const trigger = useMenuTrigger(setMenu);
	const actions: ActionItem[] = [
		{ key: "pin", label: pinned ? "取消置顶" : "置顶", icon: pinned ? PinOff : Pin, onSelect: () => togglePin(key) },
	];
	return (
		<>
			<a
				href={href({ tab: "chats", session: key })}
				{...trigger}
				className={`press no-select flex items-center gap-3 px-4 py-3 hover:bg-tone/60 ${active ? "bg-tone" : pinned ? "bg-tone/40" : ""}`}
				aria-current={active ? "page" : undefined}
				data-testid="import-row"
			>
				<Avatar seed={s.cwd ?? s.id} group="import" />
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2">
						<span className="truncate text-body font-medium">{s.title || "未命名会话"}</span>
						<span className="ml-auto shrink-0 text-caption text-faint">{clock(s.modified)}</span>
					</span>
					<span className="mt-0.5 block truncate text-small text-muted">
						{s.messages} 条 · {s.cwd?.replace(/^\/Users\/[^/]+/, "~") ?? "未知目录"}
					</span>
				</span>
			</a>
			{menu && <ActionMenu at={menu} title={s.title} actions={actions} onClose={() => setMenu(null)} />}
		</>
	);
}

export function SessionList({ active, only }: { active?: string; only?: Group[] }) {
	const sessions = useSessions();
	const imports = useImports(!only || only.includes("import"));
	const activity = useActivity();
	const prefs = usePrefs();
	const [q, setQ] = useState("");
	const running = useMemo(
		() => new Set(activity.data?.sessions.filter((x) => x.state === "running").map((x) => x.id)),
		[activity.data],
	);

	const groups = useMemo(() => {
		const by: Record<Group, SessionInfo[]> = { bot: [], task: [], import: [] };
		for (const s of sessions.data ?? []) {
			if (s.closed && s.id !== active) continue;
			if (q && !titleOf(s).toLowerCase().includes(q.toLowerCase())) continue;
			by[groupOf(s)].push(s);
		}
		for (const g of Object.values(by)) {
			g.sort(
				(a, b) =>
					Number(prefs.pinned.includes(b.id)) - Number(prefs.pinned.includes(a.id)) || b.opened.localeCompare(a.opened),
			);
		}
		return by;
	}, [sessions.data, q, prefs.pinned, active]);

	const importRows = useMemo(() => {
		const rows = (imports.data?.sessions ?? []).filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase()));
		return rows.sort(
			(a, b) => Number(prefs.pinned.includes(importRoute(b.id))) - Number(prefs.pinned.includes(importRoute(a.id))),
		);
	}, [imports.data, q, prefs.pinned]);
	const order: Group[] = (only ?? ["bot", "task", "import"]).filter(
		(g) => (g === "import" ? importRows.length : groups[g].length) > 0,
	);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="px-4 pt-3 pb-2">
				<label className="field flex items-center gap-2 rounded-control bg-tone px-3 py-2">
					<Search size={16} className="text-faint" aria-hidden />
					<input
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="搜索"
						className="min-w-0 flex-1 bg-transparent text-small outline-none placeholder:text-faint"
					/>
				</label>
			</div>
			<div className="scroll-y min-h-0 flex-1">
				{sessions.isLoading && <p className="px-4 py-6 text-small text-faint">加载中…</p>}
				{sessions.isError && <p className="px-4 py-6 text-small text-danger">会话加载失败，稍后自动重试。</p>}
				{sessions.data && order.length === 0 && (
					<p className="px-4 py-10 text-center text-small text-faint">{q ? "没有匹配的会话" : "还没有会话"}</p>
				)}
				{order.map((g) => (
					<section key={g}>
						<h2 className="px-4 pt-3 pb-1 text-caption text-faint">{GROUP_TITLE[g]}</h2>
						{g === "import"
							? importRows.map((s) => <ImportRow key={s.id} s={s} active={importRoute(s.id) === active} />)
							: groups[g].map((s) => <Row key={s.id} s={s} active={s.id === active} running={running.has(s.id)} />)}
					</section>
				))}
			</div>
		</div>
	);
}
