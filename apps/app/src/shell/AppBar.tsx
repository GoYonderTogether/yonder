import type { ReactNode } from "react";

export function AppBar({ title, left, right }: { title: ReactNode; left?: ReactNode; right?: ReactNode }) {
	return (
		<header className="relative z-10 flex h-14 shrink-0 items-center gap-2 px-4">
			{left}
			<h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h1>
			{right}
		</header>
	);
}
