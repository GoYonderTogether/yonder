import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "../../lib/cn";

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
	const ref = useRef<HTMLDialogElement>(null);
	const id = useId();
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	}, [open]);
	return (
		<dialog
			ref={ref}
			aria-labelledby={id}
			onCancel={(e) => {
				e.preventDefault();
				onOpenChange(false);
			}}
			className={cn(
				"fixed m-auto max-h-[90dvh] w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-card bg-raised text-ink shadow-float outline-none backdrop:bg-ink/30",
				className,
			)}
		>
			<header className="flex h-12 shrink-0 items-center justify-between bg-list pr-2 pl-5">
				<h2 id={id} className="text-[14px] font-medium">
					{title}
				</h2>
				<button
					type="button"
					aria-label="关闭"
					onClick={() => onOpenChange(false)}
					className="press flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-tone"
				>
					<X size={16} />
				</button>
			</header>
			{children}
		</dialog>
	);
}
