import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useAppBack } from "../lib/navigation";

export function AppBar({
	title,
	left,
	right,
	subtitle,
	className,
	headingClassName,
}: {
	title: ReactNode;
	left?: ReactNode;
	right?: ReactNode;
	subtitle?: ReactNode;
	className?: string;
	headingClassName?: string;
}) {
	return (
		<header className={className ?? "relative z-10 flex h-14 shrink-0 items-center gap-2 px-4"}>
			{headingClassName ? (
				<div className={headingClassName}>
					{left}
					<h1>{title}</h1>
					{subtitle}
				</div>
			) : (
				<>
					{left}
					<div className="min-w-0 flex-1">
						<h1 className="truncate text-body font-semibold">{title}</h1>
						{subtitle && <div className="truncate text-caption text-muted">{subtitle}</div>}
					</div>
				</>
			)}
			{right}
		</header>
	);
}

export function BackButton({ to }: { to?: string }) {
	const back = useAppBack(to ?? "/");
	return (
		<button
			type="button"
			className="press -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-tone lg:hidden"
			onClick={back}
			aria-label="返回"
		>
			<ArrowLeft size={20} aria-hidden />
		</button>
	);
}

/** 设置类页面：占内容区，内容列最大 720。 */
export function Page({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
	return (
		<div className="scroll-y h-full bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-panel lg:shadow-soft">
			<div className={`mx-auto px-4 pb-24 lg:px-6 lg:pb-10 ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
				<h1 className="display rise pt-6 pb-6 lg:pt-10">{title}</h1>
				<div className="rise flex flex-col gap-6" style={{ animationDelay: "60ms" }}>
					{children}
				</div>
			</div>
		</div>
	);
}
