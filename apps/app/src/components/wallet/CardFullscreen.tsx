import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

/** 点开名片看全屏：卡居中，点哪里都关闭。 */
export function CardFullscreen({
	open,
	onOpenChange,
	label,
	children,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	label: string;
	children: ReactNode;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fade fixed inset-0 z-40 bg-ground" />
				<Dialog.Content
					aria-describedby={undefined}
					onClick={() => onOpenChange(false)}
					className="fade fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
				>
					<Dialog.Title className="sr-only">{label}</Dialog.Title>
					<div className="w-[min(440px,100%,calc((100dvh-2rem)*3/4.3))]">{children}</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
