import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** 桌面小窗口：标题栏 + 关闭按钮，居中浮起。 */
export function Window({
	open,
	onOpenChange,
	title,
	className,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fade fixed inset-0 z-40 bg-ink/30" />
				<Dialog.Content
					className={cn(
						"rise fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card bg-raised shadow-float outline-none",
						className,
					)}
				>
					<header className="flex h-12 shrink-0 items-center justify-between bg-list pr-2 pl-5">
						<Dialog.Title className="text-[14px] font-medium">{title}</Dialog.Title>
						<Dialog.Close
							aria-label="关闭"
							className="press flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-tone"
						>
							<X size={16} />
						</Dialog.Close>
					</header>
					<Dialog.Description className="sr-only">{title}</Dialog.Description>
					{children}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
