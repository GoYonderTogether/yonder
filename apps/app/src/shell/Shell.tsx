import { lazy, Suspense, useEffect } from "react";
import { mux } from "../api/stream";
import { Chat } from "../features/Chat";
import { OnboardingCard } from "../features/messages/OnboardingCard";
import { NotifyHost } from "../features/notify/NotifyHost";
import { IMPORT_PREFIX } from "../lib/imports";
import { useRefetchOnReconnect } from "../lib/queries";
import { useSession } from "../lib/useSession";
import { Banner } from "../ui/Banner";
import { SessionList } from "../ui/SessionList";
import { TopBar } from "../ui/TopBar";
import { EmptyPane } from "./EmptyPane";
import { IconRail } from "./IconRail";
import { frameOf, type Screen } from "./layoutMode";
import { PageSkeleton } from "./PageSkeleton";
import { PAGES, pageComponent } from "./registry";
import { useRoute } from "./routes";
import { TabBar } from "./TabBar";
import { useBreakpoint } from "./useBreakpoint";

const Settings = lazy(() => import("../features/Settings").then((m) => ({ default: m.Settings })));
const Contacts = lazy(() => import("../ui/Contacts").then((m) => ({ default: m.Contacts })));
const WorkList = lazy(() => import("../ui/WorkList").then((m) => ({ default: m.WorkList })));

function Title({ children }: { children: React.ReactNode }) {
	return <h1 className="pt-safe px-4 pt-3 pb-1 text-title font-semibold">{children}</h1>;
}

export function Shell({ onLogout }: { onLogout(): void }) {
	const route = useRoute();
	const breakpoint = useBreakpoint();
	useRefetchOnReconnect();
	// 保持一条活动订阅：连接状态驱动断线提示与重连补齐
	useEffect(() => mux.subscribe("activity.watch", {}, { onReady: () => undefined, onEvent: () => undefined }), []);
	// 当前会话只订一次：聊天区、任务列表进度、右栏卡片、悬浮窗共用同一份
	const live = route.session && !route.session.startsWith(IMPORT_PREFIX) ? route.session : undefined;
	const view = useSession(live);

	const side =
		route.tab === "me" ? (
			<Settings onLogout={onLogout} />
		) : route.tab === "contacts" ? (
			<Contacts />
		) : route.tab === "work" ? (
			<>
				<Title>工作</Title>
				<div className="min-h-0 flex-1">
					<WorkList active={route.session} view={view} />
				</div>
			</>
		) : (
			<>
				<Title>消息</Title>
				<SessionList active={route.session} />
			</>
		);
	const Page = route.page && !(PAGES[route.page].needsId && !route.session) ? pageComponent(route.page) : undefined;
	const feature = Page ? (
		<Suspense fallback={<PageSkeleton />}>
			<Page id={route.session ?? ""} />
		</Suspense>
	) : undefined;
	const hasChat = route.session && (route.page === "s" || route.page === "work");
	const empty = route.tab === "work" ? "选择一个 Bot 或任务" : "选择一个会话开始";
	// 页型只看当前路由：设置（#/me）、其它功能页、会话、列表；档位差异全交给 layoutMode。
	const screen: Screen =
		route.page === "me" ? "settings" : feature !== undefined ? "page" : hasChat && route.session ? "session" : "list";
	const frame = frameOf(breakpoint, screen);

	const sideContent = <Suspense fallback={<PageSkeleton />}>{side}</Suspense>;
	// 主区优先级与拆分前一致：功能页 > 会话 > 列表（手机占满主区）/ 空态。
	const main =
		feature ??
		(hasChat && route.session ? (
			<Chat id={route.session} wide={frame.chatWide} v={view} />
		) : frame.side === "main" ? (
			<main className="flex min-h-0 flex-1 flex-col">{sideContent}</main>
		) : (
			<EmptyPane message={empty} />
		));
	return (
		<div className="flex h-dvh flex-col bg-list">
			<TopBar title="Yonder" />
			<Banner />
			<NotifyHost />
			<OnboardingCard />
			<div className="flex min-h-0 flex-1">
				{frame.mode.nav === "iconrail" && <IconRail route={route} />}
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
					{frame.tabBar && <TabBar route={route} />}
				</div>
			</div>
		</div>
	);
}
