import { useInfiniteQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { chatApi, chatError } from "../../api/chat";
import type { ConversationDetail, Message } from "../../api/types";
import { groupMemberName } from "../../lib/groupMemberName";
import { Button } from "../../ui/Button";
import { Markdown } from "../Markdown";

/** 本地日历日的起止时刻：结束排除，避免午夜消息跨日重复。 */
export function historyDayRange(day: string): { from?: number; to?: number } {
	if (!day) return {};
	const from = new Date(`${day}T00:00:00`);
	if (!Number.isFinite(from.getTime())) return {};
	const to = new Date(from);
	to.setDate(to.getDate() + 1);
	return { from: from.getTime(), to: to.getTime() };
}
export function historySummary(message: Message) {
	const c = message.content;
	return c.type === "text" || c.type === "markdown"
		? c.text
		: c.type === "image"
			? (c.name ?? "图片")
			: c.type === "file"
				? c.name
				: c.title;
}
export function ChatHistory({
	d,
	images = false,
	onSelectMessage,
	preview,
	onPreviewChange,
}: {
	d: ConversationDetail;
	images?: boolean;
	onSelectMessage?: (message: Message) => void;
	preview: Message | null;
	onPreviewChange: (message: Message | null) => void;
}) {
	const [q, setQ] = useState(""),
		[day, setDay] = useState(""),
		[filters, setFilters] = useState({ q: "", day: "", images });
	const range = historyDayRange(filters.day);
	const result = useInfiniteQuery({
		queryKey: ["chat-history", d.id, filters],
		initialPageParam: undefined as number | undefined,
		queryFn: ({ pageParam }) =>
			chatApi.history(d.id, {
				q: filters.q,
				...range,
				kind: filters.images ? "image" : undefined,
				before: pageParam,
				limit: 40,
			}),
		getNextPageParam: (page) => (page.hasMore ? page.items.at(-1)?.seq : undefined),
		retry: false,
	});
	const items = result.data?.pages.flatMap((page) => page.items) ?? [];
	const sender = (message: Message) => {
		const member = d.members.find((member) => member.id === message.senderId);
		return member ? (d.kind === "group" ? groupMemberName(member) : member.name) : "已退出的成员";
	};
	const time = (message: Message) => new Date(message.createdAt).toLocaleString();
	if (preview)
		return (
			<section className="flex flex-col gap-4 p-4">
				<div>
					<p className="text-small font-medium">{sender(preview)}</p>
					<p className="mt-1 text-caption text-muted">{time(preview)}</p>
				</div>
				<div className="rounded-card bg-tone p-4 break-words">
					{preview.content.type === "image" ? (
						<a href={preview.content.url} target="_blank" rel="noreferrer">
							<img
								src={preview.content.url}
								alt={preview.content.name ?? "聊天图片"}
								className="max-h-[60dvh] w-full rounded-control object-contain"
							/>
							<span className="mt-3 block text-center text-caption text-muted">查看原图</span>
						</a>
					) : preview.content.type === "markdown" ? (
						<Markdown text={preview.content.text} />
					) : (
						<p className="whitespace-pre-wrap text-small leading-relaxed">{historySummary(preview)}</p>
					)}
				</div>
				{onSelectMessage && <Button onClick={() => onSelectMessage(preview)}>查看上下文</Button>}
			</section>
		);
	return (
		<div className="flex flex-col gap-4 p-4">
			<form
				className="flex flex-col gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					setFilters((current) => ({ ...current, q: q.trim(), day }));
				}}
			>
				<label className="flex h-11 items-center gap-2 rounded-control bg-tone px-3">
					<Search size={17} className="shrink-0 text-muted" />
					<span className="sr-only">搜索聊天记录</span>
					<input
						value={q}
						onChange={(event) => setQ(event.target.value)}
						type="search"
						maxLength={200}
						placeholder="搜索聊天记录"
						className="min-w-0 flex-1 bg-transparent text-small outline-none"
					/>
				</label>
				<div className="flex items-center gap-2">
					<label className="flex min-w-0 flex-1 items-center gap-2 text-small text-muted">
						日期
						<input
							type="date"
							aria-label="日期"
							value={day}
							onChange={(event) => setDay(event.target.value)}
							className="field h-10 min-w-0 flex-1 rounded-control bg-tone px-2 text-ink"
						/>
					</label>
					<Button type="submit">查找</Button>
				</div>
			</form>
			<div role="tablist" aria-label="记录类型" className="flex gap-1 rounded-full bg-tone p-1">
				{[
					{ value: false, label: "消息" },
					{ value: true, label: "图片" },
				].map((tab) => (
					<button
						type="button"
						key={tab.label}
						role="tab"
						aria-selected={filters.images === tab.value}
						onClick={() => setFilters((current) => ({ ...current, images: tab.value }))}
						className={
							"press flex-1 rounded-full py-2 text-small " +
							(filters.images === tab.value ? "bg-raised font-medium" : "text-muted")
						}
					>
						{tab.label}
					</button>
				))}
			</div>
			{(filters.q || filters.day) && (
				<div className="flex items-center justify-between gap-2 text-caption text-muted">
					<span className="truncate">{[filters.q, filters.day].filter(Boolean).join(" · ")}</span>
					<button
						type="button"
						className="press shrink-0 p-2"
						onClick={() => {
							setQ("");
							setDay("");
							setFilters((current) => ({ ...current, q: "", day: "" }));
						}}
					>
						清除
					</button>
				</div>
			)}
			{result.isPending ? (
				<p role="status" className="py-8 text-center text-small text-muted">
					正在查找…
				</p>
			) : result.isError && !result.data ? (
				<div role="alert" className="flex flex-col items-center gap-3 py-6">
					<p className="text-small text-danger">{chatError(result.error, "无法查询聊天记录")}</p>
					<Button onClick={() => void result.refetch()}>重试</Button>
				</div>
			) : !items.length ? (
				<p role="status" className="py-8 text-center text-small text-muted">
					{filters.q || filters.day ? "没有找到符合条件的记录" : filters.images ? "还没有图片" : "还没有聊天记录"}
				</p>
			) : (
				<ul className={filters.images ? "grid grid-cols-2 gap-2" : "flex flex-col divide-y divide-hairline"}>
					{items.map((message) => (
						<li key={message.id}>
							<button
								type="button"
								aria-label={`查看 ${sender(message)} ${time(message)}`}
								className={`press w-full overflow-hidden text-left ${filters.images ? "rounded-control" : "py-3"}`}
								onClick={() => onPreviewChange(message)}
							>
								{filters.images && message.content.type === "image" ? (
									<>
										<img
											loading="lazy"
											src={message.content.url}
											alt={message.content.name ?? "聊天图片"}
											className="aspect-square w-full object-cover"
										/>
										<span className="block px-1 py-2 text-caption text-muted">
											{new Date(message.createdAt).toLocaleDateString()}
										</span>
									</>
								) : (
									<>
										<span className="flex items-center justify-between gap-2 text-caption text-muted">
											<span className="truncate">{sender(message)}</span>
											<span className="shrink-0">{new Date(message.createdAt).toLocaleDateString()}</span>
										</span>
										<span className="mt-1 block line-clamp-3 whitespace-pre-wrap text-small leading-relaxed">
											{historySummary(message)}
										</span>
									</>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
			{result.hasNextPage && (
				<Button disabled={result.isFetchingNextPage} onClick={() => void result.fetchNextPage()}>
					{result.isFetchingNextPage ? "加载中…" : "更早的记录"}
				</Button>
			)}
			{result.isFetchNextPageError && (
				<p role="alert" className="text-small text-danger">
					{chatError(result.error, "加载更早的记录失败，请重试")}
				</p>
			)}
		</div>
	);
}
