import { Bot, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type ReactNode, useRef } from "react";
import { cn } from "../../lib/cn";

export function AgentMark({ small = false }: { small?: boolean }) {
	return (
		<span className={cn("mk-agent-mark", small && "is-small")}>
			<Bot size={small ? 15 : 23} strokeWidth={1.7} />
		</span>
	);
}

export function MarketDialog({
	open,
	close,
	title,
	eyebrow,
	children,
	wide = false,
	className,
}: {
	open: boolean;
	close: () => void;
	title: string;
	eyebrow?: string;
	children: ReactNode;
	wide?: boolean;
	className?: string;
}) {
	const returnFocus = useRef<HTMLElement | null>(null);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(value) => {
				if (!value) close();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="mk-overlay" />
				<Dialog.Content
					className={cn("mk-dialog", wide && "mk-dialog-wide", className)}
					onOpenAutoFocus={() => {
						returnFocus.current = document.activeElement as HTMLElement;
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (returnFocus.current?.isConnected) returnFocus.current.focus();
					}}
				>
					<header className="mk-dialog-header">
						<div>
							{eyebrow && <p className="mk-eyebrow">{eyebrow}</p>}
							<Dialog.Title>{title}</Dialog.Title>
						</div>
						<Dialog.Close className="mk-icon-button" aria-label="关闭窗口">
							<X size={21} />
						</Dialog.Close>
					</header>
					<Dialog.Description className="sr-only">{title}</Dialog.Description>
					{children}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export function SellerAvatar({ name }: { name: string }) {
	return <span className="mk-seller-avatar">{name.slice(0, 1)}</span>;
}
