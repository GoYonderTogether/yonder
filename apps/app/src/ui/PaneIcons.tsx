import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };
/** Tabler Icons 3.46.0, MIT; see tabler/LICENSE. Paths preserve the upstream four pane states. */
function PaneIcon({
	side,
	direction,
	size = 24,
	...props
}: Props & { side: "left" | "right"; direction: "expand" | "collapse" }) {
	const arrow =
		side === "left"
			? direction === "collapse"
				? "M15 10l-2 2l2 2"
				: "M14 10l2 2l-2 2"
			: direction === "collapse"
				? "M9 10l2 2l-2 2"
				: "M10 10l-2 2l2 2";
	return (
		<svg
			aria-hidden="true"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			{...props}
		>
			<path stroke="none" d="M0 0h24v24H0z" fill="none" />
			<path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" />
			<path d={side === "left" ? "M9 4v16" : "M15 4v16"} />
			<path d={arrow} />
		</svg>
	);
}
export const PaneLeftCollapse = (props: Props) => <PaneIcon {...props} side="left" direction="collapse" />;
export const PaneLeftExpand = (props: Props) => <PaneIcon {...props} side="left" direction="expand" />;
export const PaneRightCollapse = (props: Props) => <PaneIcon {...props} side="right" direction="collapse" />;
export const PaneRightExpand = (props: Props) => <PaneIcon {...props} side="right" direction="expand" />;
