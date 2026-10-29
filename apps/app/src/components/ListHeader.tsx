import { Search } from "lucide-react";
import { PlusMenu } from "./PlusMenu";

/** 桌面列表列顶部：搜索框 + 加号菜单。 */
export function ListHeader({ q, onChange }: { q: string; onChange: (q: string) => void }) {
	return (
		<div className="flex shrink-0 items-center gap-2 px-3 pt-4 pb-2">
			<label className="field flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control bg-tone px-3 text-faint">
				<Search size={16} />
				<input
					value={q}
					onChange={(e) => onChange(e.target.value)}
					placeholder="搜索"
					className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
				/>
			</label>
			<PlusMenu />
		</div>
	);
}
