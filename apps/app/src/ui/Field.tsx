import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, useId, useState } from "react";
import { cn } from "../lib/cn";

export function Field({
	label,
	className,
	passwordToggle,
	type,
	...p
}: InputHTMLAttributes<HTMLInputElement> & { label: string; passwordToggle?: boolean }) {
	const [visible, setVisible] = useState(false);
	const id = useId();
	return (
		<div className="flex flex-col gap-1.5 text-[13px] text-muted">
			<label htmlFor={id}>{label}</label>
			<span className="relative">
				<input
					id={id}
					className={cn(
						"field h-11 w-full rounded-control bg-tone px-3.5 text-[15px] text-ink outline-none placeholder:text-faint",
						passwordToggle && "pr-12",
						className,
					)}
					type={passwordToggle && visible ? "text" : type}
					{...p}
				/>
				{passwordToggle && (
					<button
						type="button"
						aria-label={visible ? "隐藏密码" : "显示密码"}
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => setVisible(!visible)}
						className="press absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-full text-muted hover:text-ink"
					>
						{visible ? <EyeOff size={18} /> : <Eye size={18} />}
					</button>
				)}
			</span>
		</div>
	);
}
