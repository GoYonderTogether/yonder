import type { CSSProperties } from "react";

/** 极淡的氛围色块。父元素需要 relative，内容放在 z-10。 */
export function Ambient({ hue }: { hue: number }) {
	return <div aria-hidden className="ambient" style={{ "--h": hue } as CSSProperties} />;
}

const dots = [
	[12, 18],
	[28, 8],
	[46, 22],
	[63, 10],
	[79, 20],
	[90, 9],
];

/** 零星光点：6 个，很小。 */
export function Sparkles() {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden">
			{dots.map(([x, y], i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: 静态装饰点，顺序固定
				<span key={i} className="sparkle" style={{ left: `${x}%`, top: `${y}%`, "--i": i } as CSSProperties} />
			))}
		</div>
	);
}
