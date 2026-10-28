import { useShell } from "../lib/shell";

/**
 * 桌面壳顶部栏：只在壳里渲染（浏览器不渲染）。
 * 左侧给 macOS 红绿灯留 80px；右侧给 Windows 标题栏按钮留 140px。整条可拖动窗口。
 */
export function TopBar({ title }: { title: string }) {
	const { desktop, mac } = useShell();
	if (!desktop) return null;
	return (
		<header
			className="flex h-10 shrink-0 items-center border-b border-hairline bg-rail text-caption text-muted"
			style={
				{ paddingLeft: mac ? 80 : 12, paddingRight: mac ? 12 : 140, WebkitAppRegion: "drag" } as React.CSSProperties
			}
			data-testid="topbar"
		>
			<span className="truncate">{title}</span>
		</header>
	);
}
