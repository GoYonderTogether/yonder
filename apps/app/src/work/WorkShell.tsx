import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigationType } from "react-router";
import { api } from "../api";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { Avatar } from "../ui/Avatar";
import { useActiveNode } from "./api/nodes";
import { mux } from "./api/stream";
import { Chat, FloatMenu } from "./features/Chat";
import { useImport } from "./features/ImportView";
import { NotifyHost } from "./features/notify/NotifyHost";
import { useBranchLabel } from "./lib/branch";
import { isImported } from "./lib/identity";
import { IMPORT_PREFIX } from "./lib/imports";
import { deviceAgentMap, useDeviceAgents, useRefetchOnReconnect, useTitleOf } from "./lib/queries";
import { useRailContent } from "./lib/railContent";
import { useSession } from "./lib/useSession";
import { EmptyPane } from "./shell/EmptyPane";
import { frameOf, type Screen } from "./shell/layoutMode";
import { PageSkeleton } from "./shell/PageSkeleton";
import { useBreakpoint } from "./shell/useBreakpoint";
import { parseWork, useWorkRoute, workPath } from "./shell/workRoutes";
import { Banner } from "./ui/Banner";
import { FloatLayer } from "./ui/FloatLayer";
import { CardStack } from "./ui/RailStack";
import { WorkList } from "./ui/WorkList";
import { WorkToolbar } from "./ui/WorkToolbar";

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
export function WorkShell({
	onLogout: _onLogout,
	allWork,
	device,
}: {
	onLogout(): void;
	allWork?: ReactNode;
	device?: ReactNode;
}) {
	const route = useWorkRoute();
	const node = useActiveNode();
	const cloudDevice = !!node.deviceId;
	const breakpoint = useBreakpoint();
	const location = useLocation();
	const navigationType = useNavigationType();
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
	const titleOf = useTitleOf();
	const deviceAgents = useDeviceAgents();
	const session = view.session;
	const actor =
		session?.agent && (session.mode === "main" || session.mode === "persistent") && node.deviceId
			? deviceAgentMap(node.deviceId, deviceAgents.data ?? []).get(session.agent)
			: undefined;
	const profile = useQuery({
		queryKey: ["bot-profile", node.id, actor?.id],
		enabled: !!actor,
		queryFn: () => api.profile(actor!.id),
		refetchInterval: 5000,
	});
	const branch = useBranchLabel(session);

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
		const previous = parseWork(prev.pathname);
		const sameDevice = (previous.deviceId ?? node.deviceId) === (route.deviceId ?? node.deviceId);
		if (
			route.session &&
			(navigationType === "PUSH" ||
				(navigationType === "REPLACE" && previous.session === route.session && sameDevice)) &&
			prev.key !== location.key &&
			intent.mode === "list"
		) {
			update({ mode: "auto", phoneContent: true });
		}
	}, [location, route.session, route.deviceId, node.deviceId, navigationType, intent.mode, update]);
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
			<Navigate to="/me/settings" replace />
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
			<WorkToolbar
				phone={breakpoint === "phone"}
				leading={<PersonalAvatar />}
				title="工作"
				device={device}
				leftOpen
				onLeft={() => (paneMode === "list" ? setPaneMode("content") : update({ left: false, lastSide: "right" }))}
			/>
			<div className="min-h-0 flex-1">{allWork ?? <WorkList active={route.session} />}</div>
		</>
	);
	const sideContent = <Suspense fallback={<PageSkeleton />}>{side}</Suspense>;
	const contentHeader = (
		<WorkToolbar
			phone={breakpoint === "phone"}
			leading={
				route.session || page ? (
					<Link
						to={workPath()}
						aria-label="返回"
						className="press grid size-11 shrink-0 place-items-center rounded-full"
					>
						<ArrowLeft size={20} aria-hidden />
					</Link>
				) : (
					<PersonalAvatar />
				)
			}
			title={
				route.session ? (
					<span className="flex min-w-0 items-center gap-2">
						{actor && <Avatar actor={actor} size={32} />}
						<span className="truncate">{imported.data?.summary.title || (session ? titleOf(session) : "会话")}</span>
					</span>
				) : page ? (
					"工作设置"
				) : (
					""
				)
			}
			subtitle={
				route.session
					? [
							session?.mode === "persistent" ? branch : undefined,
							profile.data?.summary ?? actor?.summary,
							view.running ? "正在回复…" : session?.closed ? "已结束" : undefined,
						]
							.filter(Boolean)
							.join(" · ") || undefined
					: undefined
			}
			leftOpen={paneMode === "list" || (paneMode === "auto" && panes.left)}
			onLeft={!panes.left ? showList : undefined}
			rightOpen={panes.rail}
			onRight={route.session ? toggleRail : undefined}
			more={
				paneMode !== "rail" ? (
					<>
						{session?.mode === "main" && session.agent && !isImported(session) && (
							<DropdownMenu.Item
								onSelect={openChannels}
								className="press flex min-h-11 cursor-pointer items-center rounded-control px-3 text-small outline-none data-[highlighted]:bg-tone"
							>
								渠道与子会话
							</DropdownMenu.Item>
						)}
						{route.session && <FloatMenu session={route.session} />}
						<DropdownMenu.Item
							onSelect={() => update({ mode: "auto", left: true, right: "auto", panel: "work", phoneContent: false })}
							className="press flex min-h-11 cursor-pointer items-center rounded-control px-3 text-small outline-none data-[highlighted]:bg-tone"
						>
							恢复默认视图
						</DropdownMenu.Item>
					</>
				) : undefined
			}
		/>
	);
	const main =
		paneMode === "list" && route.session ? (
			<main className="flex min-h-0 flex-1 flex-col">{sideContent}</main>
		) : paneMode === "rail" && route.session ? (
			<main className="relative min-h-0 flex-1" aria-label="右栏">
				{contentHeader}
				<CardStack
					session={route.session}
					v={imported.data ? { ...view, todos: imported.data.todo?.items ?? [] } : view}
				/>
				<FloatLayer session={route.session} v={view} />
			</main>
		) : page ? (
			<Suspense fallback={<PageSkeleton />}>{page}</Suspense>
		) : route.session ? (
			<Chat
				header={contentHeader}
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
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{contentHeader}
				<EmptyPane message="选择一个 Bot 或任务" />
			</div>
		);
	return (
		<div className="flex h-full flex-col bg-rail">
			<Banner />
			<NotifyHost />
			<div className="flex min-h-0 flex-1 gap-1.5 p-1.5 pt-0">
				{paneMode === "auto" && panes.left && (
					<aside className="flex w-[320px] shrink-0 flex-col overflow-hidden rounded-card bg-list shadow-soft">
						{sideContent}
					</aside>
				)}
				<div
					className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-card bg-ground shadow-soft"
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
						<div
							className="absolute inset-0 z-20 flex flex-col overflow-hidden rounded-card bg-list shadow-float"
							data-testid="list-overlay"
						>
							{sideContent}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
