import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const button = cva(
	"press inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-small font-medium whitespace-nowrap disabled:pointer-events-none disabled:opacity-40",
	{
		variants: {
			variant: {
				primary: "bg-accent text-on-accent hover:opacity-90",
				secondary: "bg-tone text-ink hover:bg-tone-2",
				ghost: "text-muted hover:bg-tone hover:text-ink",
			},
			size: { md: "h-10 px-4", sm: "h-8 px-3 text-small", icon: "h-10 w-10", "icon-sm": "h-8 w-8" },
		},
		defaultVariants: { variant: "secondary", size: "md" },
	},
);

export function Button({
	className,
	variant,
	size,
	...p
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
	return <button className={cn(button({ variant, size }), className)} {...p} />;
}
