import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ActionItem } from "../lib/actions";
import type { MenuAnchor } from "../lib/useLongPress";

/** 右键与长按共用：同一份 ActionItem[]。Esc 关闭并把焦点还给触发元素；窄屏贴底成为底部菜单。 */
export function ActionMenu({
	at,
	title,
	actions,
	onClose,
}: {
	at: MenuAnchor;
	title: string;
	actions: ActionItem[];
	onClose(): void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const sheet = matchMedia("(max-width: 767px)").matches;
	const [from] = useState(() => document.activeElement as HTMLElement | null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el || sheet) return;
		const r = el.getBoundingClientRect();
		setPos({
			left: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)),
			top: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)),
		});
	}, [at, sheet]);

	useEffect(() => {
		ref.current?.querySelector<HTMLElement>("button")?.focus();
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				const items = [...(ref.current?.querySelectorAll<HTMLElement>("button") ?? [])];
				const i = items.indexOf(document.activeElement as HTMLElement);
				items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
			}
		};
		addEventListener("keydown", key);
		return () => {
			removeEventListener("keydown", key);
			from?.focus?.();
		};
	}, [onClose, from]);

	return createPortal(
		// biome-ignore lint/a11y/noStaticElementInteractions: 点击遮罩关闭；键盘用 Esc 关闭，见上方 keydown
		<div
			role="presentation"
			className="fixed inset-0 z-50"
			onPointerDown={onClose}
			onContextMenu={(e) => {
				e.preventDefault();
				onClose();
			}}
		>
			<div className={sheet ? "absolute inset-0 bg-ink/30 fade" : ""} />
			<div
				ref={ref}
				role="menu"
				aria-label={title}
				onPointerDown={(e) => e.stopPropagation()}
				className={
					sheet
						? "rise absolute inset-x-0 bottom-0 rounded-t-[20px] bg-raised px-2 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-float"
						: "rise absolute min-w-48 rounded-card bg-raised p-1.5 shadow-float"
				}
				style={
					sheet ? undefined : { left: pos?.left ?? at.x, top: pos?.top ?? at.y, visibility: pos ? "visible" : "hidden" }
				}
			>
				{sheet && <div className="truncate px-3 pb-2 text-caption text-faint">{title}</div>}
				{actions.map((a) => (
					<button
						key={a.key}
						type="button"
						role="menuitem"
						aria-label={a.checked ? `${a.label}（已选）` : a.label}
						onClick={() => {
							onClose();
							a.onSelect();
						}}
						className={`press flex w-full items-center gap-3 rounded-control px-3 py-3 text-left text-body md:py-2 md:text-small hover:bg-tone ${a.danger ? "text-danger" : "text-ink"}`}
					>
						{a.icon && <a.icon size={18} className="text-muted" />}
						<span className="flex-1">{a.label}</span>
						{a.checked && <Check size={16} aria-hidden />}
					</button>
				))}
			</div>
		</div>,
		document.body,
	);
}
