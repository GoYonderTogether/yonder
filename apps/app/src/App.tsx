import { useQueryClient } from "@tanstack/react-query";
import { CircleUser, MessageCircle, Monitor, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Chat } from "./features/Chat";
import { Login } from "./features/Login";
import { Settings } from "./features/Settings";
import { IMPORT_PREFIX } from "./lib/imports";
import { useActivity, useFacts, useRefetchOnReconnect } from "./lib/queries";
import { href, type Route, type Tab, useMedia, useRoute } from "./lib/useHash";
import { useSession } from "./lib/useSession";
import { logout, onUnauthorized, RpcError } from "./transport/client";
import { mux } from "./transport/stream";
import { Avatar } from "./ui/Avatar";
import { Banner } from "./ui/Banner";
import { Contacts } from "./ui/Contacts";
import { SessionList } from "./ui/SessionList";
import { TopBar } from "./ui/TopBar";
import { WorkList } from "./ui/WorkList";

const NAV: { tab: Tab; label: string; icon: typeof MessageCircle }[] = [
	{ tab: "chats", label: "消息", icon: MessageCircle },
	{ tab: "contacts", label: "通讯录", icon: Users },
	{ tab: "work", label: "工作", icon: Monitor },
];

/** 移动端底部导航：消息 / 通讯录 / 工作 / 我，与桌面图标栏一一对应 */
function TabBar({ route }: { route: Route }) {
	const act = useActivity();
	const running = act.data?.running ?? 0;
	const items = [...NAV, { tab: "me" as Tab, label: "我", icon: CircleUser }];
	return (
		<nav className="safe-b grid grid-cols-4 border-t border-hairline bg-rail" aria-label="主导航" data-testid="tabbar">
			{items.map(({ tab, label, icon: Icon }) => (
				<a
					key={tab}
					href={href({ tab })}
					aria-current={route.tab === tab ? "page" : undefined}
					className={`press relative flex flex-col items-center gap-0.5 py-2 text-caption ${route.tab === tab ? "text-ink" : "text-faint"}`}
				>
					<Icon size={22} aria-hidden strokeWidth={route.tab === tab ? 2.2 : 1.8} />
					{label}
					{tab === "work" && running > 0 && (
						<span
							className="absolute top-1 left-1/2 ml-2 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] leading-none text-white"
							role="img"
							aria-label={`${running} 个运行中`}
						>
							{running}
						</span>
					)}
				</a>
			))}
		</nav>
	);
}

/** 桌面图标栏：消息、通讯录、工作（Monitor），底部头像进入个人页与设置 */
function IconRail({ route }: { route: Route }) {
	const act = useActivity();
	const running = act.data?.running ?? 0;
	return (
		<nav
			className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-hairline bg-rail py-3"
			aria-label="主导航"
			data-testid="icon-rail"
		>
			{NAV.map(({ tab, label, icon: Icon }) => (
				<a
					key={tab}
					href={href({ tab })}
					title={label}
					aria-current={route.tab === tab ? "page" : undefined}
					className={`press relative flex w-12 flex-col items-center gap-0.5 rounded-control py-1.5 text-[11px] ${route.tab === tab ? "bg-tone text-ink" : "text-faint"}`}
				>
					<Icon size={20} aria-hidden />
					{label}
					{tab === "work" && running > 0 && (
						<span
							className="absolute top-0.5 right-1 size-2 rounded-full bg-danger"
							role="img"
							aria-label={`${running} 个运行中`}
						/>
					)}
				</a>
			))}
			<a
				href={href({ tab: "me" })}
				title="我"
				aria-label="我"
				aria-current={route.tab === "me" ? "page" : undefined}
				className="press mt-auto rounded-full"
				data-testid="avatar"
			>
				<Avatar seed="me" group="bot" size={34} />
			</a>
		</nav>
	);
}

function Title({ children }: { children: React.ReactNode }) {
	return <h1 className="pt-safe px-4 pt-3 pb-1 text-title font-semibold">{children}</h1>;
}

function Shell({ onLogout }: { onLogout(): void }) {
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
	const hasChat = route.session && (route.tab === "chats" || route.tab === "work");
	const empty = route.tab === "work" ? "选择一个 Bot 或任务" : "选择一个会话开始";

	if (wide)
		return (
			<div className="flex h-dvh flex-col">
				<TopBar title="Yonder" />
				<Banner />
				<div className="flex min-h-0 flex-1">
					<IconRail route={route} />
					<aside className="flex w-[320px] shrink-0 flex-col border-r border-hairline bg-list">{side}</aside>
					{hasChat && route.session ? (
						<Chat id={route.session} wide v={view} />
					) : (
						<main className="grid flex-1 place-items-center bg-ground text-small text-faint">{empty}</main>
					)}
				</div>
			</div>
		);

	return (
		<div className="flex h-dvh flex-col bg-list">
			<TopBar title="Yonder" />
			<Banner />
			{hasChat && route.session ? (
				<div className="flex min-h-0 flex-1">
					<Chat id={route.session} wide={false} v={view} />
				</div>
			) : (
				<>
					<main className="flex min-h-0 flex-1 flex-col">{side}</main>
					<TabBar route={route} />
				</>
			)}
		</div>
	);
}

export function App() {
	const qc = useQueryClient();
	const facts = useFacts();
	const [authed, setAuthed] = useState<boolean | undefined>(undefined);
	useEffect(() => onUnauthorized(() => setAuthed(false)), []);
	useEffect(() => {
		if (facts.data) setAuthed(true);
		else if (facts.error instanceof RpcError && facts.error.code === "unauthorized") setAuthed(false);
	}, [facts.data, facts.error]);

	if (authed === false)
		return (
			<Login
				onDone={() => {
					setAuthed(undefined);
					void qc.resetQueries();
				}}
			/>
		);
	if (authed === undefined)
		return (
			<div className="grid h-dvh place-items-center text-small text-faint">
				{facts.isError ? `无法连接网关：${facts.error.message}` : "连接中…"}
			</div>
		);
	return (
		<Shell
			onLogout={() => {
				mux.reset();
				void logout().finally(() => {
					qc.clear();
					setAuthed(false);
				});
			}}
		/>
	);
}
