import { Monitor, Plus, ScanLine, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";
import { href, useMedia } from "../../shell/routes";
import { GroupWindow } from "./PlusWindows";

export function PlusMenu() {
	const [open, setOpen] = useState(false);
	const [group, setGroup] = useState(false);
	const desktop = useMedia("(min-width: 768px)");
	return (
		<>
			<div className="relative">
				<button
					type="button"
					aria-label="更多"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="press flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-tone"
				>
					<Plus size={22} strokeWidth={1.75} />
				</button>
				{open && (
					<div className="rise absolute right-0 z-50 min-w-40 rounded-card bg-raised p-1.5 shadow-float">
						<button
							type="button"
							className="press flex h-11 w-full items-center gap-3 rounded-control px-3 text-[15px] hover:bg-tone"
							onClick={() => {
								setOpen(false);
								setGroup(true);
							}}
						>
							<UsersRound size={19} strokeWidth={1.75} className="text-muted" />
							发起群聊
						</button>
						<a
							className="press flex h-11 items-center gap-3 rounded-control px-3 text-[15px] hover:bg-tone"
							href={href({ tab: "contacts", page: "friends/add" })}
						>
							<UserPlus size={19} strokeWidth={1.75} className="text-muted" />
							添加朋友
						</a>
						<a
							className="press flex h-11 items-center gap-3 rounded-control px-3 text-[15px] hover:bg-tone"
							href={href({ tab: "contacts", page: "connect" })}
						>
							<Monitor size={19} strokeWidth={1.75} className="text-muted" />
							添加设备
						</a>
						{!desktop && (
							<a
								className="press flex h-11 items-center gap-3 rounded-control px-3 text-[15px] hover:bg-tone"
								href={`${href({ tab: "contacts", page: "friends/add" })}/scan`}
							>
								<ScanLine size={19} strokeWidth={1.75} className="text-muted" />
								扫一扫
							</a>
						)}
					</div>
				)}
			</div>
			<GroupWindow open={group} onOpenChange={setGroup} />
		</>
	);
}
