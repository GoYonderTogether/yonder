import { Settings as SettingsIcon } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { Link, Navigate } from "react-router";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { useActiveNode } from "./api/nodes";
import { mux } from "./api/stream";
import { Chat } from "./features/Chat";
import { NotifyHost } from "./features/notify/NotifyHost";
import { IMPORT_PREFIX } from "./lib/imports";
import { useRefetchOnReconnect } from "./lib/queries";
import { useSession } from "./lib/useSession";
import { EmptyPane } from "./shell/EmptyPane";
import { frameOf, type Screen } from "./shell/layoutMode";
import { PageSkeleton } from "./shell/PageSkeleton";
import { useBreakpoint } from "./shell/useBreakpoint";
import { useWorkRoute, workPath } from "./shell/workRoutes";
import { Banner } from "./ui/Banner";
import { WorkList } from "./ui/WorkList";

const Settings = lazy(() => import("./features/Settings").then((m) => ({ default: m.Settings })));
const ConsoleSwitcher = lazy(() =>
	import("./features/console/ConsoleSwitcher").then((m) => ({ default: m.ConsoleSwitcher })),
);

/**
 * 「工作」区外壳：挂在名片站 Shell 的内容区里（导航由名片站提供），
 * 自己只管 工作列表 | 会话 | 右栏 的布局；功能页（控制台、市场、设置）占满主区。
 */
export function WorkShell({ onLogout }: { onLogout(): void }) {
	const route = useWorkRoute();
	const cloudDevice = !!useActiveNode().deviceId;
	const breakpoint = useBreakpoint();
	useRefetchOnReconnect();
	// 保持一条活动订阅：连接状态驱动断线提示与重连补齐
	useEffect(() => mux.subscribe("activity.watch", {}, { onReady: () => undefined, onEvent: () => undefined }), []);
	// 当前会话只订一次：聊天区、任务列表进度、右栏卡片、悬浮窗共用同一份
	const live = route.session && !route.session.startsWith(IMPORT_PREFIX) ? route.session : undefined;
	const view = useSession(live);

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

	const side = (
		<>
			<div className="flex items-center pr-2">
				<div className="pl-4">
					<PersonalAvatar />
				</div>
				<h1 className="pt-safe flex-1 px-4 pt-3 pb-1 text-title font-semibold">工作</h1>
				<Link
					to={workPath({ page: "settings" })}
					aria-label="工作设置"
					title="工作设置"
					className="press grid size-9 place-items-center rounded-full text-muted"
				>
					<SettingsIcon size={19} aria-hidden />
				</Link>
			</div>
			<div className="min-h-0 flex-1">
				<WorkList active={route.session} />
			</div>
		</>
	);
	const sideContent = <Suspense fallback={<PageSkeleton />}>{side}</Suspense>;
	const main = page ? (
		<Suspense fallback={<PageSkeleton />}>{page}</Suspense>
	) : route.session ? (
		<Chat id={route.session} wide={frame.chatWide} v={view} />
	) : frame.side === "main" ? (
		<main className="flex min-h-0 flex-1 flex-col">{sideContent}</main>
	) : (
		<EmptyPane message="选择一个 Bot 或任务" />
	);
	return (
		<div className="flex h-full flex-col bg-list">
			<Banner />
			<NotifyHost />
			<div className="flex min-h-0 flex-1">
				{frame.side === "column" && (
					<aside className="flex w-[320px] shrink-0 flex-col border-r border-hairline bg-list">{sideContent}</aside>
				)}
				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
					<div className={`flex min-h-0 min-w-0 flex-1 ${frame.chatWide ? "flex-row" : "flex-col"}`}>{main}</div>
					{/* 平板：列表按需叠成覆盖层，打开会话或功能页即收起 */}
					{frame.side === "overlay" && (
						<div className="absolute inset-0 z-20 flex flex-col bg-list" data-testid="list-overlay">
							{sideContent}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
