import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };
/** Tabler Icons 3.46.0, MIT; see tabler/LICENSE. */
function PaneIcon({
	side,
	size = 24,
	...props
}: Props & { side: "left" | "right" }) {
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
		</svg>
	);
}
export const PaneLeftCollapse = (props: Props) => <PaneIcon {...props} side="left" />;
export const PaneLeftExpand = (props: Props) => <PaneIcon {...props} side="left" />;
export const PaneRightCollapse = (props: Props) => <PaneIcon {...props} side="right" />;
export const PaneRightExpand = (props: Props) => <PaneIcon {...props} side="right" />;
