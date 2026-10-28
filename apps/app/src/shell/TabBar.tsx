import { CircleUser, MessageCircle, Monitor, Users } from "lucide-react";
import { useActivity } from "../lib/queries";
import { href, type Route, type Tab } from "./routes";

export const NAV: { tab: Tab; label: string; icon: typeof MessageCircle }[] = [
	{ tab: "chats", label: "消息", icon: MessageCircle },
	{ tab: "contacts", label: "通讯录", icon: Users },
	{ tab: "work", label: "工作", icon: Monitor },
];

/** 移动端底部导航：消息 / 通讯录 / 工作 / 我，与桌面图标栏一一对应 */
export function TabBar({ route }: { route: Route }) {
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
