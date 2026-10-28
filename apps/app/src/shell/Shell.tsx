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
import { PageSkeleton } from "./PageSkeleton";
import { PAGES, pageComponent } from "./registry";
import { useMedia, useRoute } from "./routes";
import { TabBar } from "./TabBar";

const Settings = lazy(() => import("../features/Settings").then((m) => ({ default: m.Settings })));
const Contacts = lazy(() => import("../ui/Contacts").then((m) => ({ default: m.Contacts })));
const WorkList = lazy(() => import("../ui/WorkList").then((m) => ({ default: m.WorkList })));

function Title({ children }: { children: React.ReactNode }) {
	return <h1 className="pt-safe px-4 pt-3 pb-1 text-title font-semibold">{children}</h1>;
}

export function Shell({ onLogout }: { onLogout(): void }) {
	const route = useRoute();
	const wide = useMedia("(min-width: 1024px)");
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

	if (wide)
		return (
			<div className="flex h-dvh flex-col">
				<TopBar title="Yonder" />
				<Banner />
				<NotifyHost />
				<OnboardingCard />
				<div className="flex min-h-0 flex-1">
					<IconRail route={route} />
					<aside className="flex w-[320px] shrink-0 flex-col border-r border-hairline bg-list">
						<Suspense fallback={<PageSkeleton />}>{side}</Suspense>
					</aside>
					{feature !== undefined ? (
						feature
					) : hasChat && route.session ? (
						<Chat id={route.session} wide v={view} />
					) : (
						<EmptyPane message={empty} />
					)}
				</div>
			</div>
		);

	return (
		<div className="flex h-dvh flex-col bg-list">
			<TopBar title="Yonder" />
			<Banner />
			<NotifyHost />
			<OnboardingCard />
			{feature !== undefined ? (
				feature
			) : hasChat && route.session ? (
				<div className="flex min-h-0 flex-1">
					<Chat id={route.session} wide={false} v={view} />
				</div>
			) : (
				<>
					<main className="flex min-h-0 flex-1 flex-col">
						<Suspense fallback={<PageSkeleton />}>{side}</Suspense>
					</main>
					<TabBar route={route} />
				</>
			)}
		</div>
	);
}
