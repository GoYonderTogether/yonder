import { useQueryClient } from "@tanstack/react-query";
import { CircleUser, ListChecks, LogOut, MessageCircle, MonitorSmartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Chat } from "./features/Chat";
import { Login } from "./features/Login";
import { useActivity, useFacts, useRefetchOnReconnect } from "./lib/queries";
import { href, type Route, useMedia, useRoute } from "./lib/useHash";
import { logout, onUnauthorized, RpcError } from "./transport/client";
import { mux } from "./transport/stream";
import { Banner } from "./ui/Banner";
import { SessionList } from "./ui/SessionList";

const TABS: { tab: Route["tab"]; label: string; icon: typeof MessageCircle }[] = [
	{ tab: "chats", label: "消息", icon: MessageCircle },
	{ tab: "tasks", label: "任务", icon: ListChecks },
	{ tab: "devices", label: "设备", icon: MonitorSmartphone },
	{ tab: "me", label: "我", icon: CircleUser },
];

function TabBar({ route }: { route: Route }) {
	const act = useActivity();
	const running = act.data?.running ?? 0;
	return (
		<nav className="safe-b grid grid-cols-4 border-t border-hairline bg-rail" aria-label="主导航" data-testid="tabbar">
			{TABS.map(({ tab, label, icon: Icon }) => (
				<a
					key={tab}
					href={href({ tab })}
					aria-current={route.tab === tab ? "page" : undefined}
					className={`press relative flex flex-col items-center gap-0.5 py-2 text-caption ${route.tab === tab ? "text-ink" : "text-faint"}`}
				>
					<Icon size={22} aria-hidden strokeWidth={route.tab === tab ? 2.2 : 1.8} />
					{label}
					{tab === "tasks" && running > 0 && (
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

function Title({ children }: { children: React.ReactNode }) {
	return <h1 className="pt-safe px-4 pt-3 pb-1 text-title font-semibold">{children}</h1>;
}

function Devices() {
	const f = useFacts();
	const d = f.data;
	const rows: [string, string][] = d
		? [
				["版本", `${d.version.yonder}${d.version.commit ? ` (${d.version.commit.slice(0, 7)})` : ""}`],
				["连接方式", d.kind === "local" ? "本机" : "远程"],
				["权限", d.granted.join(" / ")],
				["协议版本", String(d.protocol)],
				["可用方法", `${Object.keys(d.methods).length} 个`],
			]
		: [];
	return (
		<div className="scroll-y h-full">
			<Title>设备</Title>
			<section className="mx-4 mt-2 rounded-card bg-raised p-4" data-testid="device-card">
				<h2 className="mb-2 flex items-center gap-2 text-body font-medium">
					<span className="size-2 rounded-full bg-online" aria-hidden />
					当前节点
				</h2>
				{f.isLoading && <p className="text-small text-faint">加载中…</p>}
				{f.isError && <p className="text-small text-danger">{f.error.message}</p>}
				<dl className="grid grid-cols-[6em_1fr] gap-y-1.5 text-small">
					{rows.map(([k, v]) => (
						<div key={k} className="contents">
							<dt className="text-muted">{k}</dt>
							<dd className="min-w-0 break-words">{v}</dd>
						</div>
					))}
				</dl>
			</section>
			<p className="mx-4 mt-3 text-caption text-faint">多设备节点列表要等网关提供 nodes 接口后显示。</p>
		</div>
	);
}

function Me({ onLogout }: { onLogout(): void }) {
	const f = useFacts();
	return (
		<div className="scroll-y h-full">
			<Title>我</Title>
			<section className="mx-4 mt-2 rounded-card bg-raised p-4 text-small">
				<p>已登录 · {f.data?.kind === "local" ? "本机票据" : "远程访问令牌"}</p>
				<p className="mt-1 text-faint">会话置顶、免打扰和已读位置只保存在这台设备的浏览器里。</p>
			</section>
			<button
				type="button"
				onClick={onLogout}
				className="press mx-4 mt-3 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-card bg-raised py-3 text-body text-danger"
			>
				<LogOut size={17} aria-hidden /> 退出登录
			</button>
		</div>
	);
}

function Shell({ onLogout }: { onLogout(): void }) {
	const route = useRoute();
	const wide = useMedia("(min-width: 1024px)");
	useRefetchOnReconnect();
	// 保持一条活动订阅：连接状态驱动断线提示与重连补齐
	useEffect(() => mux.subscribe("activity.watch", {}, { onReady: () => undefined, onEvent: () => undefined }), []);

	const list =
		route.tab === "tasks" ? (
			<SessionList active={route.session} only={["task"]} />
		) : (
			<SessionList active={route.session} />
		);
	const side =
		route.tab === "devices" ? (
			<Devices />
		) : route.tab === "me" ? (
			<Me onLogout={onLogout} />
		) : (
			<>
				<Title>{route.tab === "tasks" ? "任务" : "消息"}</Title>
				{list}
			</>
		);

	if (wide)
		return (
			<div className="flex h-dvh flex-col">
				<Banner />
				<div className="flex min-h-0 flex-1">
					<nav
						className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-hairline bg-rail py-3"
						aria-label="主导航"
					>
						{TABS.map(({ tab, label, icon: Icon }) => (
							<a
								key={tab}
								href={href({ tab })}
								title={label}
								aria-current={route.tab === tab ? "page" : undefined}
								className={`press flex w-12 flex-col items-center gap-0.5 rounded-control py-1.5 text-[11px] ${route.tab === tab ? "bg-tone text-ink" : "text-faint"}`}
							>
								<Icon size={20} aria-hidden />
								{label}
							</a>
						))}
					</nav>
					<aside className="flex w-[320px] shrink-0 flex-col border-r border-hairline bg-list">{side}</aside>
					{route.session ? (
						<Chat id={route.session} wide />
					) : (
						<main className="grid flex-1 place-items-center bg-ground text-small text-faint">选择一个会话开始</main>
					)}
				</div>
			</div>
		);

	return (
		<div className="flex h-dvh flex-col bg-list">
			<Banner />
			{route.session ? (
				<div className="flex min-h-0 flex-1">
					<Chat id={route.session} wide={false} />
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
