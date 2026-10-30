import { PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { useActiveNode } from "./api/nodes";
import { mux } from "./api/stream";
import { Chat } from "./features/Chat";
import { useImport } from "./features/ImportView";
import { NotifyHost } from "./features/notify/NotifyHost";
import { IMPORT_PREFIX } from "./lib/imports";
import { setRailPref, useRailPref } from "./lib/layout";
import { useRefetchOnReconnect } from "./lib/queries";
import { useRailContent } from "./lib/railContent";
import { useSession } from "./lib/useSession";
import { EmptyPane } from "./shell/EmptyPane";
import { frameOf, paneVisibility, phoneRailVisible, type Screen } from "./shell/layoutMode";
import { PageSkeleton } from "./shell/PageSkeleton";
import { useBreakpoint } from "./shell/useBreakpoint";
import { useWorkRoute, workPath } from "./shell/workRoutes";
import { Banner } from "./ui/Banner";
import { WorkList } from "./ui/WorkList";

const Settings = lazy(() => import("./features/Settings").then((m) => ({ default: m.Settings })));
const ConsoleSwitcher = lazy(() =>
	import("./features/console/ConsoleSwitcher").then((m) => ({ default: m.ConsoleSwitcher })),
);
const phoneRailChoices = new Map<string, boolean>();

/**
 * 「工作」区外壳：挂在名片站 Shell 的内容区里（导航由名片站提供），
 * 自己只管 工作列表 | 会话 | 右栏 的布局；功能页（控制台、市场、设置）占满主区。
 */
export function WorkShell({ onLogout, allWork }: { onLogout(): void; allWork?: ReactNode }) {
	const route = useWorkRoute();
	const node = useActiveNode();
	const cloudDevice = !!node.deviceId;
	const breakpoint = useBreakpoint();
	const [leftOpen, setLeftOpen] = useState(true);
	const [manualRail, setManualRail] = useState<string>();
	const [, refreshPhoneChoice] = useState(0);
	const railPref = useRailPref();
	useRefetchOnReconnect();
	// 保持一条活动订阅：连接状态驱动断线提示与重连补齐
	useEffect(() => mux.subscribe("activity.watch", {}, { onReady: () => undefined, onEvent: () => undefined }), []);
	// 当前会话只订一次：聊天区、任务列表进度、右栏卡片、悬浮窗共用同一份
	const live = route.session && !route.session.startsWith(IMPORT_PREFIX) ? route.session : undefined;
	const imported = useImport(
		route.session?.startsWith(IMPORT_PREFIX) ? route.session.slice(IMPORT_PREFIX.length) : undefined,
	);
	const view = useSession(live);
	const content = useRailContent(live, view);
	const hasRail = !!(live && view.session?.id === live && content) || !!imported.data?.todo?.items.length;
	const sessionKey = route.session ? `${node.id}:${route.session}` : "";
	const phoneChoice = phoneRailChoices.get(sessionKey);
	const showRail =
		!!route.session &&
		(breakpoint === "phone"
			? phoneRailVisible(hasRail, phoneChoice)
			: railPref.open && (hasRail || manualRail === sessionKey));
	const toggleRail = () => {
		if (breakpoint === "phone") {
			phoneRailChoices.set(sessionKey, !showRail);
			refreshPhoneChoice((n) => n + 1);
		} else {
			setRailPref({ open: !showRail });
			setManualRail(!showRail ? sessionKey : undefined);
			if (!showRail && breakpoint === "tablet") setLeftOpen(false);
		}
	};
	const showList = () => {
		setLeftOpen(true);
		if (breakpoint === "tablet" && showRail) setRailPref({ open: false });
	};

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
	const panes = paneVisibility(breakpoint, screen, leftOpen, showRail);

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
						onClick={() => setLeftOpen(false)}
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
	const main = page ? (
		<Suspense fallback={<PageSkeleton />}>{page}</Suspense>
	) : route.session ? (
		<Chat
			id={route.session}
			wide={breakpoint !== "phone"}
			v={view}
			showRail={showRail}
			onRail={toggleRail}
			onList={breakpoint !== "phone" && !panes.left ? showList : undefined}
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
			<div className="flex min-h-0 flex-1">
				{panes.left && (
					<aside className="flex w-[320px] shrink-0 flex-col border-r border-hairline bg-list">{sideContent}</aside>
				)}
				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
					<div className={`flex min-h-0 min-w-0 flex-1 ${frame.chatWide ? "flex-row" : "flex-col"}`}>{main}</div>
					{/* 平板：列表按需叠成覆盖层，打开会话或功能页即收起 */}
					{frame.side === "overlay" && leftOpen && (
						<div className="absolute inset-0 z-20 flex flex-col bg-list" data-testid="list-overlay">
							{sideContent}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
