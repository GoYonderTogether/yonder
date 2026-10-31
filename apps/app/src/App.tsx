import { useStore } from "@nanostores/react";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router";
import { PageLoading } from "./components/PageLoading";
import { PersonalAgentGate } from "./components/PersonalAgentGate";
import { useSocialService } from "./lib/useWorkEntry";
import { $session } from "./store";
import { Toaster } from "./ui/Toast";

const Shell = lazy(() => import("./components/Shell").then((m) => ({ default: m.Shell })));
const NewFriends = lazy(() => import("./pages/Friends").then((m) => ({ default: m.NewFriends })));
const AddFriend = lazy(() => import("./pages/AddFriend").then((m) => ({ default: m.AddFriend })));
const Contacts = lazy(() => import("./pages/Contacts").then((m) => ({ default: m.Contacts })));
const CardsRedirect = lazy(() => import("./pages/Contacts").then((m) => ({ default: m.CardsRedirect })));
const CardPage = lazy(() => import("./pages/CardPage").then((m) => ({ default: m.CardPage })));
const GroupJoin = lazy(() => import("./pages/GroupJoin").then((m) => ({ default: m.GroupJoin })));
const Conversation = lazy(() => import("./pages/Chat").then((m) => ({ default: m.Conversation })));
const ChatShell = lazy(() => import("./pages/Chat").then((m) => ({ default: m.ChatShell })));
const Connect = lazy(() => import("./pages/Connect").then((m) => ({ default: m.Connect })));
const Install = lazy(() => import("./pages/Install").then((m) => ({ default: m.Install })));
const Download = lazy(() => import("./pages/Download").then((m) => ({ default: m.Download })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Market = lazy(() => import("./pages/Market").then((m) => ({ default: m.Market })));
const WorkRoot = lazy(() => import("./work/WorkRoot"));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const Me = lazy(() => import("./pages/Me").then((m) => ({ default: m.Me })));

function Private({ children }: { children: ReactNode }) {
	const s = useStore($session);
	const loc = useLocation();
	if (s === undefined) return null;
	return s && !(s.actor.anonymous && loc.pathname.startsWith("/cards")) ? (
		children
	) : (
		<Navigate to="/login" state={{ next: loc.pathname + loc.search }} replace />
	);
}

export function App() {
	const qc = useQueryClient();
	const session = useStore($session);
	useEffect(() => {
		if (session) qc.setQueryData(["session", session.actor.id], session);
	}, [session, qc]);
	const social = useSocialService();
	if (social === "pending") return <PageLoading />;
	if (social === "none")
		return (
			<>
				<Toaster />
				<Suspense fallback={<PageLoading />}>
					<Routes>
						<Route path="/get" element={<Install />} />
						<Route path="/download" element={<Download />} />
						<Route path="/me/settings/:section?" element={<SettingsPage local />} />
						<Route path="/work/*" element={<WorkRoot />} />
						<Route path="*" element={<Navigate to="/work" replace />} />
					</Routes>
				</Suspense>
			</>
		);
	return (
		<>
			<Toaster />
			<Suspense fallback={<PageLoading />}>
				<Routes>
					<Route path="/login" element={<Login />} />
					<Route path="/u/:id" element={<CardPage />} />
					<Route path="/p/:accountId" element={<CardPage />} />
					<Route path="/g/:token" element={<GroupJoin />} />
					<Route path="/get" element={<Install />} />
					<Route path="/download" element={<Download />} />
					<Route
						element={
							<Private>
								<PersonalAgentGate>
									<Shell />
								</PersonalAgentGate>
							</Private>
						}
					>
						<Route path="/pa" element={<Navigate to="/" replace />} />
						<Route path="/market" element={<Market />} />
						<Route path="/market/search" element={<Market />} />
						<Route path="/market/category/:channel" element={<Market />} />
						<Route path="/me/market/:section" element={<Market />} />
						<Route path="/cards/:id?" element={<CardsRedirect />} />
						<Route path="/cards/:id/edit" element={<CardsRedirect />} />
						<Route path="/friends/new" element={<NewFriends />} />
						<Route path="/friends/add" element={<AddFriend />} />
						<Route path="/contacts/:id?" element={<Contacts />} />
						<Route path="/connect" element={<Connect />} />
						<Route path="/me" element={<Me />} />
						<Route path="/me/settings/:section?" element={<SettingsPage />} />
						<Route path="/work/*" element={<WorkRoot />} />
						<Route element={<ChatShell />}>
							<Route path="/" element={null} />
							<Route path="/c/:id" element={<Conversation />} />
						</Route>
					</Route>
					<Route
						path="*"
						element={
							<div className="flex h-full flex-col items-center justify-center gap-4 p-6">
								<h1 className="text-title font-semibold">页面不存在</h1>
								<Link to="/" className="text-small underline">
									回到消息
								</Link>
							</div>
						}
					/>
				</Routes>
			</Suspense>
		</>
	);
}
