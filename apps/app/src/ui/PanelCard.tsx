import { ChevronDown, ChevronUp, GripVertical, PanelRightClose, PictureInPicture2 } from "lucide-react";
import type { HTMLAttributes, Ref } from "react";
import { dock, PANEL_TITLE, type PanelKind, setActive, toggleFloat } from "../lib/layout";
import type { SessionView } from "../lib/useSession";
import { countOf, PanelBody } from "./PanelBody";

export interface PanelCardProps {
	placement: "floating" | "rail";
	session: string;
	v: SessionView;
	tabs: PanelKind[];
	active: PanelKind;
	cardId: string;
	collapsed?: boolean;
	onToggleCollapse?(): void;
	/** 把手：右栏用 dnd-kit 的 listeners，悬浮窗用指针拖动 */
	handleProps?: HTMLAttributes<HTMLElement>;
	handleRef?: Ref<HTMLButtonElement>;
}

/** 右栏卡片与悬浮窗是同一个组件，仅 placement 不同。 */
export function PanelCard(p: PanelCardProps) {
	const floating = p.placement === "floating";
	const collapsed = floating && p.collapsed;
	const count = countOf(p.active, p.v);
	return (
		<section
			className={`flex min-h-0 flex-col overflow-hidden bg-raised ${floating ? "w-72 rounded-card shadow-float" : "rounded-card shadow-soft"}`}
			data-testid={`panel-${p.placement}`}
			data-kind={p.active}
			aria-label={PANEL_TITLE[p.active]}
		>
			<header className="flex items-center gap-1 border-b border-hairline px-1.5 py-1">
				<button
					type="button"
					ref={p.handleRef}
					{...p.handleProps}
					aria-label="拖动"
					title="拖动"
					className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-control text-faint active:cursor-grabbing"
				>
					<GripVertical size={15} aria-hidden />
				</button>
				{p.tabs.length > 1 ? (
					<div role="tablist" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
						{p.tabs.map((t) => (
							<button
								key={t}
								type="button"
								role="tab"
								aria-selected={t === p.active}
								onClick={() => setActive(p.session, p.cardId, t)}
								className={`press shrink-0 rounded-control px-2 py-1 text-caption ${t === p.active ? "bg-tone text-ink" : "text-faint"}`}
							>
								{PANEL_TITLE[t]}
							</button>
						))}
					</div>
				) : (
					<h3 className="min-w-0 flex-1 truncate px-1 text-small font-medium">{PANEL_TITLE[p.active]}</h3>
				)}
				{count && !collapsed && <span className="shrink-0 text-caption text-faint">{count}</span>}
				<button
					type="button"
					onClick={() => (floating ? dock(p.session, p.active) : toggleFloat(p.session, p.active))}
					aria-label={floating ? "停靠到右栏" : "弹出为悬浮窗"}
					title={floating ? "停靠到右栏" : "弹出为悬浮窗"}
					className="press grid size-7 shrink-0 place-items-center rounded-control text-faint"
				>
					{floating ? <PanelRightClose size={15} aria-hidden /> : <PictureInPicture2 size={15} aria-hidden />}
				</button>
				{floating && (
					<button
						type="button"
						onClick={p.onToggleCollapse}
						aria-label={collapsed ? "展开" : "收起"}
						aria-expanded={!collapsed}
						className="press grid size-7 shrink-0 place-items-center rounded-control text-faint"
					>
						{collapsed ? <ChevronDown size={15} aria-hidden /> : <ChevronUp size={15} aria-hidden />}
					</button>
				)}
			</header>
			{!collapsed && (
				<div className={`scroll-y px-3 py-2.5 ${floating ? "max-h-72" : ""}`}>
					<PanelBody kind={p.active} v={p.v} session={p.session} />
				</div>
			)}
		</section>
	);
}
