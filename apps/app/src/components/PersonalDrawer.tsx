import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { Bookmark, ChevronRight, ContactRound, Monitor, Package, Settings, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../api";
import { internalState } from "../lib/navigation";
import { $session } from "../store";
import { Avatar } from "../ui/Avatar";
import { IdentityQr } from "./IdentityQr";

const DrawerContext = createContext<((trigger?: HTMLElement) => void) | null>(null);

export function PersonalAvatar() {
	const open = useContext(DrawerContext);
	const me = useStore($session)?.actor;
	if (!open || !me) return null;
	return (
		<button
			type="button"
			onClick={(event) => open(event.currentTarget)}
			aria-label="打开个人菜单"
			className="press shrink-0 rounded-full lg:hidden"
		>
			<Avatar actor={me} size={32} />
		</button>
	);
}

export function PersonalDrawerProvider({ children }: { children: ReactNode }) {
	const me = useStore($session)?.actor;
	const location = useLocation();
	const navigate = useNavigate();
	const open = location.state?.personalDrawer === true;
	const { data: profile } = useQuery({
		queryKey: ["profile", me?.id],
		queryFn: () => api.profile(me?.id ?? ""),
		enabled: open && !!me && !me.anonymous,
	});
	const trigger = useRef<HTMLElement | null>(null);
	const openDrawer = useCallback(
		(element?: HTMLElement) => {
			trigger.current = element ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
			if (!open)
				navigate(location.pathname + location.search + location.hash, {
					state: { ...location.state, personalDrawer: true },
				});
		},
		[location, navigate, open],
	);
	const closeDrawer = useCallback(() => {
		if (open) navigate(-1);
	}, [navigate, open]);
	const touch = useRef<{ x: number; y: number } | null>(null);
	const primary = ["/", "/work", "/market", "/contacts"].includes(location.pathname);
	useEffect(() => {
		const start = (event: TouchEvent) => {
			if (event.touches.length !== 1 || window.innerWidth >= 1024) return;
			const point = event.touches[0];
			if (point && (open || (primary && point.clientX <= 20))) touch.current = { x: point.clientX, y: point.clientY };
		};
		const end = (event: TouchEvent) => {
			if (!touch.current || !event.changedTouches[0]) return;
			const dx = event.changedTouches[0].clientX - touch.current.x;
			const dy = event.changedTouches[0].clientY - touch.current.y;
			touch.current = null;
			if (Math.abs(dx) < 70 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
			if (open && dx < 0) closeDrawer();
			else if (!open && dx > 0) openDrawer();
		};
		document.addEventListener("touchstart", start, { passive: true });
		document.addEventListener("touchend", end, { passive: true });
		return () => {
			document.removeEventListener("touchstart", start);
			document.removeEventListener("touchend", end);
		};
	}, [closeDrawer, open, openDrawer, primary]);
	return (
		<DrawerContext.Provider value={openDrawer}>
			{children}
			<Dialog.Root
				open={open}
				onOpenChange={(next) => {
					if (!next) closeDrawer();
				}}
			>
				<Dialog.Portal>
					<Dialog.Overlay className="fade fixed inset-0 z-40 bg-black/30" />
					<Dialog.Content
						aria-describedby={undefined}
						onCloseAutoFocus={(event) => {
							if (trigger.current?.isConnected) {
								event.preventDefault();
								trigger.current.focus();
							}
						}}
						className="personal-drawer fixed inset-0 z-50 flex flex-col overflow-y-auto bg-ground shadow-float outline-none"
					>
						<div className="relative h-36 shrink-0 bg-gradient-to-br from-accent/25 via-tone-2 to-ground pt-[env(safe-area-inset-top)]">
							<Dialog.Close
								aria-label="关闭个人菜单"
								className="press absolute top-[calc(env(safe-area-inset-top)+1rem)] right-4 grid size-10 place-items-center rounded-full bg-raised/80 text-ink"
							>
								<X size={20} />
							</Dialog.Close>
						</div>
						<div className="-mt-10 px-4">
							<div className="relative rounded-card bg-raised p-5 shadow-soft">
								<div className="flex items-start gap-4">
									{me && <Avatar actor={me} size={64} />}
									<div className="min-w-0 flex-1 pt-1">
										<Dialog.Title className="truncate text-title font-semibold">{me?.name ?? "个人"}</Dialog.Title>
										{(profile?.card?.tagline || profile?.summary || me?.summary) && (
											<p className="mt-2 text-small text-muted">
												{profile?.card?.tagline || profile?.summary || me?.summary}
											</p>
										)}
									</div>
									{me && <IdentityQr actor={me} cardId={profile?.card?.id} card={profile?.card} />}
								</div>
								{!!profile?.card?.face?.tags?.length && (
									<div className="mt-4 flex flex-wrap gap-2">
										{profile.card.face.tags.map((tag) => (
											<span key={tag} className="rounded-full bg-tone px-3 py-1 text-caption text-muted">
												{tag}
											</span>
										))}
									</div>
								)}
							</div>
						</div>
						<nav
							aria-label="个人菜单"
							className="flex flex-1 flex-col px-4 pt-5 pb-[calc(1rem+env(safe-area-inset-bottom))]"
						>
							{(
								[
									["/me", "个人资料与名片", ContactRound],
									["/me/market/posts", "我的发布", Package],
									["/me/market/saved", "市场收藏", Bookmark],
									["/connect", "添加设备", Monitor],
								] as const
							).map(([to, label, Icon]) => (
								<Link
									key={to}
									to={to}
									replace
									state={internalState(location)}
									className="press flex min-h-14 items-center gap-4 rounded-control px-2 hover:bg-tone"
								>
									<Icon size={21} className="text-accent-ink" />
									<span className="flex-1">{label}</span>
									<ChevronRight size={16} className="text-muted" />
								</Link>
							))}
							<Link
								to="/me/settings"
								replace
								state={internalState(location)}
								className="press mt-auto flex min-h-14 items-center gap-4 rounded-control px-2 text-left hover:bg-tone"
							>
								<Settings size={21} className="text-muted" />
								<span className="flex-1">设置与账号安全</span>
								<ChevronRight size={16} className="text-muted" />
							</Link>
						</nav>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</DrawerContext.Provider>
	);
}
