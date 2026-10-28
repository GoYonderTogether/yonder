import { Bot, FolderInput, ListChecks } from "lucide-react";
import { hue } from "../lib/format";
import type { Group } from "../lib/identity";

export function Avatar({ seed, group, size = 44, dot }: { seed: string; group: Group; size?: number; dot?: boolean }) {
	const Icon = group === "bot" ? Bot : group === "task" ? ListChecks : FolderInput;
	return (
		<span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
			<span
				className="agent-orb inline-flex items-center justify-center rounded-[28%] text-white"
				style={{ width: size, height: size, ["--h" as string]: hue(seed) }}
			>
				<Icon size={size * 0.46} aria-hidden />
			</span>
			{dot && (
				<span
					role="img"
					aria-label="运行中"
					className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-list bg-online"
				/>
			)}
		</span>
	);
}
