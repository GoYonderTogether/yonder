import { useState } from "react";
import type { Message } from "../../api/types";
import { Window } from "../../ui/Window";
export const messageSummary = (m: Message) =>
	"text" in m.content
		? m.content.text
		: m.content.type === "image"
			? "[图片]"
			: m.content.type === "file"
				? m.content.name
				: m.content.title;
export function PinnedMessages({
	messages,
	announcement,
	onSelect,
	onRemove,
	onClear,
	manage,
}: {
	messages: Message[];
	announcement?: Message | null;
	onSelect(m: Message): void;
	onRemove(m: Message): void;
	onClear(): void;
	manage: boolean;
}) {
	const [open, setOpen] = useState(false);
	if (!messages.length && !announcement) return null;
	return (
		<>
			<div className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2 text-small">
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="press min-w-0 flex-1 truncate text-left text-muted"
				>
					{announcement ? `群公告 · ${messageSummary(announcement)}` : `置顶 · ${messageSummary(messages[0])}`}
				</button>
				<button type="button" onClick={() => setOpen(true)} className="press shrink-0 text-caption text-muted">
					{messages.length ? `${messages.length} 条置顶` : "查看"}
				</button>
			</div>
			<Window className="social-dialog" open={open} onOpenChange={setOpen} title="群公告与置顶">
				<div className="scroll-y space-y-4 p-4">
					{announcement && (
						<section>
							<h3 className="mb-2 text-small font-medium">群公告</h3>
							<button
								type="button"
								className="press block w-full whitespace-pre-wrap rounded-control bg-tone p-3 text-left text-small"
								onClick={() => {
									setOpen(false);
									onSelect(announcement);
								}}
							>
								{messageSummary(announcement)}
							</button>
							{manage && (
								<button type="button" className="press mt-2 text-caption text-muted" onClick={onClear}>
									取消群公告
								</button>
							)}
						</section>
					)}
					{!!messages.length && (
						<section>
							<h3 className="mb-2 text-small font-medium">置顶消息</h3>
							{messages.map((m) => (
								<div key={m.id} className="mb-2 rounded-control bg-tone p-3">
									<button
										type="button"
										className="press block w-full whitespace-pre-wrap text-left text-small"
										onClick={() => {
											setOpen(false);
											onSelect(m);
										}}
									>
										{messageSummary(m)}
									</button>
									{manage && (
										<button type="button" className="press mt-2 text-caption text-muted" onClick={() => onRemove(m)}>
											取消置顶
										</button>
									)}
								</div>
							))}
						</section>
					)}
				</div>
			</Window>
		</>
	);
}
