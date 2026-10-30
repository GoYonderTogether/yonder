import { PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { useActiveNode } from "./api/nodes";
import { mux } from "./api/stream";
import { Chat } from "./features/Chat";
import { useImport } from "./features/ImportView";
import { NotifyHost } from "./features/notify/NotifyHost";
import { IMPORT_PREFIX } from "./lib/imports";
import { useRefetchOnReconnect } from "./lib/queries";
import { useRailContent } from "./lib/railContent";
import { useSession } from "./lib/useSession";
import { EmptyPane } from "./shell/EmptyPane";
import { frameOf, type Screen } from "./shell/layoutMode";
import { PageSkeleton } from "./shell/PageSkeleton";
import { useBreakpoint } from "./shell/useBreakpoint";
import { useWorkRoute, workPath } from "./shell/workRoutes";
import { Banner } from "./ui/Banner";
import { FloatLayer } from "./ui/FloatLayer";
import { CardStack } from "./ui/RailStack";
import { WorkList } from "./ui/WorkList";

const Settings = lazy(() => import("./features/Settings").then((m) => ({ default: m.Settings })));
const ConsoleSwitcher = lazy(() =>
	import("./features/console/ConsoleSwitcher").then((m) => ({ default: m.ConsoleSwitcher })),
);
type PaneMode = "auto" | "list" | "content" | "rail";
type PaneIntent = {
	mode: PaneMode;
	left: boolean;
	right: "auto" | "open" | "closed";
	panel: "work" | "channels";
	lastSide: "left" | "right";
	phoneContent: boolean;
};
const paneIntents = new Map<string, PaneIntent>();
const initialIntent: PaneIntent = {
	mode: "auto",
	left: true,
	right: "auto",
	panel: "work",
	lastSide: "right",
	phoneContent: false,
};

/**
 * 「工作」区外壳：挂在名片站 Shell 的内容区里（导航由名片站提供），
 * 自己只管 工作列表 | 会话 | 右栏 的布局；功能页（控制台、市场、设置）占满主区。
 */
export function WorkShell({ onLogout, allWork }: { onLogout(): void; allWork?: ReactNode }) {
	const route = useWorkRoute();
	const node = useActiveNode();
	const cloudDevice = !!node.deviceId;
	const breakpoint = useBreakpoint();
	const location = useLocation();
	const previousLocation = useRef(location);
	const [, refreshIntent] = useState(0);
	const lastLeft = useRef(true);
	useRefetchOnReconnect();
	useEffect(() => mux.subscribe("activity.watch", {}, { onReady: () => undefined, onEvent: () => undefined }), []);
	const live = route.session && !route.session.startsWith(IMPORT_PREFIX) ? route.session : undefined;
	const imported = useImport(
		route.session?.startsWith(IMPORT_PREFIX) ? route.session.slice(IMPORT_PREFIX.length) : undefined,
	);
	const view = useSession(live);
	const content = useRailContent(live, view);
	const railState = live
		? content
		: route.session
			? imported.isError
				? "error"
				: imported.isPending
					? "loading"
					: imported.data?.todo?.items.length
						? "present"
						: "empty"
			: "empty";
	const sessionKey = `${node.id}:${route.session ?? "__page__"}`;
	const intent = paneIntents.get(sessionKey) ?? { ...initialIntent, left: lastLeft.current };
	const update = useCallback(
		(change: Partial<PaneIntent>) => {
			const next = { ...intent, ...change };
			paneIntents.set(sessionKey, next);
			lastLeft.current = next.left;
			refreshIntent((n) => n + 1);
		},
		[intent, sessionKey],
	);
	const paneMode = intent.mode === "rail" && railState === "empty" && intent.panel === "work" ? "content" : intent.mode;
	const setPaneMode = (mode: PaneMode) => update({ mode, phoneContent: mode === "content" });
	useEffect(() => {
		const prev = previousLocation.current;
		previousLocation.current = location;
		if (route.session && prev.pathname === location.pathname && prev.key !== location.key && intent.mode === "list") {
			update({ mode: "auto", phoneContent: true });
		}
	}, [location, route.session, intent.mode, update]);
	const hasRail = railState === "present";
	const requestedRail = intent.panel === "channels" || intent.right === "open" || (intent.right === "auto" && hasRail);
	const showRail =
		!!route.session && requestedRail && !(breakpoint === "phone" && intent.phoneContent && intent.right === "auto");
	const toggleRail = () => {
		const visible = showRail && !(breakpoint === "tablet" && intent.left && intent.lastSide === "left");
		const next = !visible || paneMode !== "auto";
		update({ mode: "auto", right: next ? "open" : "closed", panel: "work", lastSide: "right", phoneContent: !next });
	};
	const showList = () => update({ mode: "auto", left: true, lastSide: "left" });
	const openChannels = () => update({ mode: "auto", panel: "channels", lastSide: "right", phoneContent: false });
	const closeChannels = () => update({ panel: "work", phoneContent: breakpoint === "phone" });
	const leftOpen = intent.left;

	const page =
		route.page === "settings" ? (
			<Settings onLogout={onLogout} />
		) : route.page === "market" ? (
			<Navigate to="/market" replace />
		) : route.page === "console" ? (
			cloudDevice ? (
				<Navigate to={workPath()} replace />
			) : (
				<ConsoleSwitcher />
			)
		) : undefined;
	const screen: Screen = page ? "page" : route.session ? "session" : "list";
	const frame = frameOf(breakpoint, screen);
	const railVisible = showRail && !(breakpoint === "tablet" && leftOpen && intent.lastSide === "left");
	const panes = {
		left:
			screen !== "session"
				? breakpoint === "desktop" && leftOpen
				: leftOpen && (breakpoint === "desktop" || (breakpoint === "tablet" && !railVisible)),
		rail: railVisible,
	};

	const side = (
		<>
			<div className="flex items-center pr-2">
				<div className="pl-4">
					<PersonalAvatar />
				</div>
				<h1 className="pt-safe flex-1 px-4 pt-3 pb-1 text-title font-semibold">工作</h1>
				{breakpoint !== "phone" && (
					<button
						type="button"
						aria-label="收起工作列表"
						onClick={() => (paneMode === "list" ? setPaneMode("content") : update({ left: false, lastSide: "right" }))}
						className="press grid size-9 place-items-center rounded-full text-muted"
					>
						<PanelLeftClose size={19} aria-hidden />
					</button>
				)}
				<Link
					to={workPath({ page: "settings" })}
					aria-label="工作设置"
					title="工作设置"
					className="press grid size-9 place-items-center rounded-full text-muted"
				>
					<SettingsIcon size={19} aria-hidden />
				</Link>
			</div>
			<div className="min-h-0 flex-1">{allWork ?? <WorkList active={route.session} />}</div>
		</>
	);
	const sideContent = <Suspense fallback={<PageSkeleton />}>{side}</Suspense>;
	const main =
		paneMode === "list" && route.session ? (
			<main className="flex min-h-0 flex-1 flex-col">{sideContent}</main>
		) : paneMode === "rail" && route.session ? (
			<main className="relative min-h-0 flex-1" aria-label="右栏">
				<CardStack
					session={route.session}
					v={imported.data ? { ...view, todos: imported.data.todo?.items ?? [] } : view}
				/>
				<FloatLayer session={route.session} v={view} />
			</main>
		) : page ? (
			<div className="relative flex min-h-0 min-w-0 flex-1">
				{breakpoint !== "phone" && !panes.left && (
					<button
						type="button"
						aria-label="展开工作列表"
						onClick={showList}
						className="absolute top-2 left-2 z-10 grid size-9 place-items-center"
					>
						<PanelLeftOpen size={19} aria-hidden />
					</button>
				)}
				<Suspense fallback={<PageSkeleton />}>{page}</Suspense>
			</div>
		) : route.session ? (
			<Chat
				id={route.session}
				wide={breakpoint !== "phone"}
				v={view}
				showRail={paneMode === "content" ? false : panes.rail}
				rightPanel={intent.panel}
				onChannels={openChannels}
				onCloseChannels={closeChannels}
				onRail={toggleRail}
				onList={breakpoint !== "phone" && (paneMode !== "auto" || !panes.left) ? showList : undefined}
			/>
		) : frame.side === "main" ? (
			<main className="flex min-h-0 flex-1 flex-col">{sideContent}</main>
		) : (
			<div className="relative flex min-h-0 flex-1">
				{!leftOpen && (
					<button
						type="button"
						aria-label="展开工作列表"
						onClick={showList}
						className="absolute top-2 left-2 z-10 grid size-9 place-items-center"
					>
						<PanelLeftOpen size={19} aria-hidden />
					</button>
				)}
				<EmptyPane message="选择一个 Bot 或任务" />
			</div>
		);
	return (
		<div className="flex h-full flex-col bg-list">
			<Banner />
			<NotifyHost />
			{route.session && (
				<label className="flex items-center gap-2 px-4 py-1 text-caption text-muted">
					显示
					<select
						aria-label="工作区域显示"
						value={intent.mode}
						onChange={(event) => setPaneMode(event.target.value as PaneMode)}
						className="field"
					>
						<option value="auto">自动</option>
						<option value="list">仅工作列表</option>
						<option value="content">仅会话</option>
						<option value="rail" disabled={!hasRail && intent.mode !== "rail"}>
							仅右栏
						</option>
					</select>
				</label>
			)}
			<div className="flex min-h-0 flex-1">
				{paneMode === "auto" && panes.left && (
					<aside className="flex w-[320px] shrink-0 flex-col border-r border-hairline bg-list">{sideContent}</aside>
				)}
				<div
					className="relative flex min-h-0 min-w-0 flex-1 flex-col"
					onFocusCapture={(event) => {
						if (
							breakpoint === "phone" &&
							(event.target instanceof HTMLTextAreaElement ||
								event.target instanceof HTMLInputElement ||
								(event.target instanceof HTMLElement && event.target.isContentEditable))
						)
							update({ phoneContent: true });
					}}
				>
					<div className={`flex min-h-0 min-w-0 flex-1 ${breakpoint !== "phone" ? "flex-row" : "flex-col"}`}>
						{main}
					</div>
					{/* 平板：列表按需叠成覆盖层，打开会话或功能页即收起 */}
					{paneMode === "auto" && frame.side === "overlay" && leftOpen && (
						<div className="absolute inset-0 z-20 flex flex-col bg-list" data-testid="list-overlay">
							{sideContent}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
