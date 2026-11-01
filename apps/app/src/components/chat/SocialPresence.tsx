import { type ReactNode, useEffect, useRef, useState } from "react";
/** Retains the last visible panel while its exit transition finishes. */
export function SocialPresence({
	open,
	kind = "panel",
	children,
}: {
	open: boolean;
	kind?: "panel" | "popup";
	children: ReactNode;
}) {
	const [mounted, setMounted] = useState(open);
	const last = useRef(children);
	if (open) last.current = children;
	useEffect(() => {
		if (open) {
			setMounted(true);
			return;
		}
		const timer = setTimeout(() => setMounted(false), 180);
		return () => clearTimeout(timer);
	}, [open]);
	if (!open && !mounted) return null;
	return (
		<div
			className="contents"
			data-social-presence={kind}
			data-state={open ? "open" : "closed"}
			aria-hidden={!open || undefined}
			inert={!open}
		>
			{open ? children : last.current}
		</div>
	);
}
