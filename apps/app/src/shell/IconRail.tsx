import { useActivity } from "../lib/queries";
import { Avatar } from "../ui/Avatar";
import { href, type Route } from "./routes";
import { NAV } from "./TabBar";

/** 桌面图标栏：消息、通讯录、工作（Monitor，含控制台入口），底部头像进入个人页与设置 */
export function IconRail({ route }: { route: Route }) {
	const act = useActivity();
	const running = act.data?.running ?? 0;
	return (
		<nav
			className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-hairline bg-rail py-3"
			aria-label="主导航"
			data-testid="icon-rail"
		>
			{NAV.map(({ tab, label, hint, icon: Icon }) => (
				<a
					key={tab}
					href={href({ tab })}
					title={hint ?? label}
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
