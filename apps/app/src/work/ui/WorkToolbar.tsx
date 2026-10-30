import { Ellipsis } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { AppBar } from "../../components/AppBar";
import { PaneLeftCollapse, PaneLeftExpand, PaneRightCollapse, PaneRightExpand } from "../../ui/PaneIcons";

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
	more?: ReactNode;
}) {
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
					{device}
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
					{more ? (
						<DropdownMenu.Root modal={false}>
							<DropdownMenu.Trigger
								aria-label="工作区更多"
								className="press grid size-10 shrink-0 place-items-center rounded-full"
							>
								<Ellipsis size={20} aria-hidden />
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content
									align="end"
									sideOffset={6}
									className="rise z-50 min-w-40 rounded-card bg-raised p-1.5 shadow-float outline-none"
								>
									{more}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					) : null}
				</div>
			}
		/>
	);
}
