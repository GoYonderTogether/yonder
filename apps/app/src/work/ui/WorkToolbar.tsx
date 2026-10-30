import { Ellipsis } from "lucide-react";
import { Popover } from "radix-ui";
import type { ReactNode } from "react";
import { AppBar } from "../../components/AppBar";
import { PaneLeftCollapse, PaneLeftExpand, PaneRightCollapse, PaneRightExpand } from "../../ui/PaneIcons";

type PaneMode = "auto" | "list" | "content" | "rail";

/** 工作模块的一行导航；会话和设备内容由调用方提供。 */
export function WorkToolbar({
	phone,
	leading,
	title,
	subtitle,
	device,
	leftOpen,
	onLeft,
	rightOpen,
	onRight,
	mode,
	onMode,
	railAvailable,
	primary,
	more,
}: {
	phone: boolean;
	leading?: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	device?: ReactNode;
	leftOpen?: boolean;
	onLeft?: () => void;
	rightOpen?: boolean;
	onRight?: () => void;
	mode?: PaneMode;
	onMode?: (mode: PaneMode) => void;
	railAvailable?: boolean;
	primary?: ReactNode;
	more?: ReactNode;
}) {
	const layout = onMode && (
		<label className="flex items-center gap-2 text-caption text-muted">
			<span>布局</span>
			<select
				aria-label="工作区域显示"
				value={mode ?? "auto"}
				onChange={(event) => onMode(event.target.value as PaneMode)}
				className="field h-11 min-w-0"
			>
				<option value="auto">自动</option>
				<option value="list">仅工作列表</option>
				<option value="content">仅会话</option>
				<option value="rail" disabled={!railAvailable}>
					仅右栏
				</option>
			</select>
		</label>
	);
	const LeftIcon = leftOpen ? PaneLeftCollapse : PaneLeftExpand;
	const RightIcon = rightOpen ? PaneRightCollapse : PaneRightExpand;
	return (
		<AppBar
			className="pt-safe relative z-10 flex min-h-14 shrink-0 items-center gap-2 px-3"
			title={title}
			subtitle={subtitle}
			left={
				phone
					? leading
					: onLeft && (
							<button
								type="button"
								aria-label={leftOpen ? "收起工作列表" : "展开工作列表"}
								aria-expanded={leftOpen}
								onClick={onLeft}
								className="press grid size-10 shrink-0 place-items-center rounded-full"
							>
								<LeftIcon size={20} aria-hidden />
							</button>
						)
			}
			right={
				<div className="flex shrink-0 items-center gap-2">
					{!phone && device}
					{!phone && primary}
					{onRight && (
						<button
							type="button"
							aria-label={rightOpen ? "收起右栏" : "展开右栏"}
							aria-expanded={rightOpen}
							onClick={onRight}
							className="press grid size-10 shrink-0 place-items-center rounded-full"
						>
							<RightIcon size={20} aria-hidden />
						</button>
					)}
					{!phone && layout}
					{more || (phone && (device || layout || primary)) ? (
						<Popover.Root>
							<Popover.Trigger
								aria-label="工作区更多"
								className="press grid size-10 shrink-0 place-items-center rounded-full"
							>
								<Ellipsis size={20} aria-hidden />
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Content
									align="end"
									sideOffset={4}
									className="z-50 flex min-w-48 flex-col gap-3 rounded-card bg-raised p-3 shadow-float outline-none"
								>
									{phone && device}
									{phone && layout}
									{phone && primary}
									{more}
								</Popover.Content>
							</Popover.Portal>
						</Popover.Root>
					) : null}
				</div>
			}
		/>
	);
}
