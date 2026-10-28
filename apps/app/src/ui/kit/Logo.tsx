export function Logo({ size = 28, radius = 0.22 }: { size?: number; radius?: number }) {
	return (
		<span
			role="img"
			aria-label="Yonder"
			className="inline-flex shrink-0 items-center justify-center bg-accent text-on-accent"
			style={{ width: size, height: size, borderRadius: size * radius, padding: size * 0.1 }}
		>
			<span
				aria-hidden
				className="h-full w-full bg-current"
				style={{ mask: `url(/brand/yonder-mark${size <= 24 ? "-small" : ""}.svg) center / contain no-repeat` }}
			/>
		</span>
	);
}
