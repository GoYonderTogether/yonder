import { useStore } from "@nanostores/react";
import { ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { internalState } from "../lib/navigation";
import { SettingsDialog } from "../pages/Me";
import { $session } from "../store";
import { Avatar } from "../ui/Avatar";

const DrawerContext = createContext<(() => void) | null>(null);

export function PersonalAvatar() {
	const open = useContext(DrawerContext);
	const me = useStore($session)?.actor;
	if (!open || !me) return null;
	return (
		<button type="button" onClick={open} aria-label="打开个人菜单" className="press shrink-0 rounded-full lg:hidden">
			<Avatar actor={me} size={32} />
		</button>
	);
}

export function PersonalDrawerProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [settings, setSettings] = useState(false);
	const me = useStore($session)?.actor;
	const location = useLocation();
	const touch = useRef<{ x: number; y: number } | null>(null);
	const primary = ["/", "/work", "/market", "/contacts"].includes(location.pathname);
	useEffect(() => {
		void location.key;
		setOpen(false);
	}, [location.key]);
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
			if (open && dx < 0) setOpen(false);
			else if (!open && dx > 0) setOpen(true);
		};
		document.addEventListener("touchstart", start, { passive: true });
		document.addEventListener("touchend", end, { passive: true });
		return () => {
			document.removeEventListener("touchstart", start);
			document.removeEventListener("touchend", end);
		};
	}, [open, primary]);
	return (
		<DrawerContext.Provider value={() => setOpen(true)}>
			{children}
			<Dialog.Root open={open} onOpenChange={setOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="fade fixed inset-0 z-40 bg-black/30" />
					<Dialog.Content
						aria-describedby={undefined}
						className="personal-drawer fixed inset-y-0 left-0 z-50 flex w-[min(320px,85vw)] flex-col overflow-y-auto bg-raised p-5 shadow-float outline-none"
					>
						<div className="flex items-center gap-3">
							{me && <Avatar actor={me} size={48} />}
							<Dialog.Title className="min-w-0 flex-1 truncate font-semibold">{me?.name ?? "个人"}</Dialog.Title>
							<Dialog.Close aria-label="关闭个人菜单" className="press grid size-10 place-items-center rounded-full">
								<X size={20} />
							</Dialog.Close>
						</div>
						<nav aria-label="个人菜单" className="mt-6 flex flex-col">
							{(
								[
									["/me", "个人资料与名片"],
									["/me/market/posts", "我的发布"],
									["/me/market/saved", "我的收藏"],
									["/connect", "添加设备"],
								] as const
							).map(([to, label]) => (
								<Link
									key={to}
									to={to}
									state={internalState(location)}
									className="press flex min-h-12 items-center gap-3 border-b border-hairline"
								>
									<span className="flex-1">{label}</span>
									<ChevronRight size={16} className="text-muted" />
								</Link>
							))}
							<button
								type="button"
								className="press flex min-h-12 items-center gap-3 text-left"
								onClick={() => {
									setOpen(false);
									setSettings(true);
								}}
							>
								<span className="flex-1">设置与账号安全</span>
								<ChevronRight size={16} className="text-muted" />
							</button>
						</nav>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
			{settings && <SettingsDialog open onOpenChange={setSettings} />}
		</DrawerContext.Provider>
	);
}
