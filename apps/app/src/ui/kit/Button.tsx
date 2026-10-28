import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const variants = {
	primary: "bg-accent text-on-accent hover:opacity-90",
	secondary: "bg-tone text-ink hover:bg-tone-2",
	ghost: "text-muted hover:bg-tone hover:text-ink",
};
const sizes = { md: "h-10 px-4", sm: "h-8 px-3 text-[13px]", icon: "h-10 w-10", "icon-sm": "h-8 w-8" };
export function Button({
	className,
	variant = "secondary",
	size = "md",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
	return (
		<button
			className={cn(
				"press inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-[14px] font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-40",
				variants[variant],
				sizes[size],
				className,
			)}
			{...props}
		/>
	);
}
