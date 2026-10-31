import { useStore } from "@nanostores/react";
import { MessageCircle, Monitor, Store, Users } from "lucide-react";
import { Suspense } from "react";
import { NavLink, Outlet, useLocation, useMatch } from "react-router";
import { cn } from "../lib/cn";
import { internalState } from "../lib/navigation";
import { useSocialService } from "../lib/useWorkEntry";
import { $session } from "../store";
import { Avatar } from "../ui/Avatar";
import { Logo } from "../ui/Logo";
import { WORK_PAGES } from "../work/shell/workRoutes";
import { PageLoading } from "./PageLoading";

const chatItem = { to: "/", label: "消息", icon: MessageCircle };
const marketItem = { to: "/market", label: "市场", icon: Store };
const contactsItem = { to: "/contacts", label: "通讯录", icon: Users };
const workItem = { to: "/work", label: "工作", icon: Monitor };

export function Shell() {
	const loc = useLocation();
	const me = useStore($session)?.actor;
	const social = useSocialService();
	const items = [chatItem, workItem, marketItem, contactsItem];
	const workMatch = useMatch("/work/:id");
	const deviceSession = useMatch("/work/device/:device/:session");
	const hidden =
		[useMatch("/c/:id"), useMatch("/contacts/:id")].some(Boolean) ||
		!!deviceSession ||
		(!!workMatch && !(WORK_PAGES as readonly string[]).includes(workMatch.params.id ?? ""));
	const active = (path: string) =>
		path === "/"
			? location.pathname === "/" || location.pathname.startsWith("/c/")
			: location.pathname.startsWith(path);
	const mobileLinks = items.map(({ to, label, icon: Icon }) => (
		<NavLink
			key={to}
			to={to}
			aria-label={label}
			title={label}
			className={cn(
				"press flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-caption text-muted",
				active(to) && "font-semibold text-ink",
			)}
		>
			<span
				className={cn(
					"flex h-8 w-12 shrink-0 items-center justify-center rounded-full",
					active(to) && "bg-accent text-on-accent",
				)}
			>
				{Icon ? <Icon size={22} strokeWidth={1.75} /> : me && <Avatar actor={me} size={22} />}
			</span>
			{label}
		</NavLink>
	));
	return (
		<div className="flex h-full flex-col lg:flex-row">
			<nav aria-label="主导航" className="hidden w-16 shrink-0 flex-col items-center gap-1 bg-rail py-4 lg:flex">
				<NavLink
					to="/"
					aria-label="首页"
					title="首页"
					className="press relative flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-tone-2 hover:text-ink"
				>
					<Logo />
				</NavLink>
				<div className="mt-5 flex flex-col gap-1">
					{items
						.filter((item) => item.icon)
						.map(({ to, label, icon: Icon }) => (
							<NavLink
								key={to}
								to={to}
								title={label}
								aria-label={label}
								className={cn(
									"press relative flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-tone-2 hover:text-ink",
									active(to) && "bg-raised text-accent-ink shadow-sm",
								)}
							>
								{active(to) && <span className="absolute -left-2.5 h-5 w-[3px] rounded-full bg-accent" />}
								{Icon && <Icon size={20} strokeWidth={1.75} />}
							</NavLink>
						))}
				</div>
				<NavLink to="/me" state={internalState(loc)} aria-label="我" title="我" className="press mt-auto rounded-full">
					{me && <Avatar actor={me} size={32} />}
				</NavLink>
			</nav>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{import.meta.env.VITE_API !== "http" && social !== "none" && (
					<div role="status" className="shrink-0 bg-tone-2 px-3 py-1 text-center text-caption text-muted">
						本地原型模式 · 展示数据仅供界面验收，不代表真实用户
					</div>
				)}
				<div className="min-h-0 min-w-0 flex-1">
					<Suspense fallback={<PageLoading />}>
						<Outlet />
					</Suspense>
				</div>
			</div>
			{!hidden && (
				<nav aria-label="主导航" className="flex shrink-0 bg-rail pb-[env(safe-area-inset-bottom)] lg:hidden">
					{mobileLinks}
				</nav>
			)}
		</div>
	);
}
