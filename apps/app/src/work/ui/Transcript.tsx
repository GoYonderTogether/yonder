import { Brain, ChevronRight, Copy, Info, Layers, Reply, Wrench } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChannelIcon } from "../features/messages/ChannelIcon";
import type { ActionItem } from "../lib/actions";
import { type ChatItem, channelName, messageClock, type ToolCall, timeBucket } from "../lib/chat";
import { useBotNames } from "../lib/queries";
import { type MenuAnchor, useMenuTrigger } from "../lib/useLongPress";
import { ActionMenu } from "./ActionMenu";
import { Markdown } from "./Markdown";

function Fold({
	icon: Icon,
	title,
	hint,
	children,
	tid,
	completed = false,
}: {
	icon: typeof Wrench;
	title: string;
	hint?: string;
	children: React.ReactNode;
	tid: string;
	completed?: boolean;
}) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (completed) setOpen(false);
	}, [completed]);
	return (
		<div className="rounded-control border border-hairline bg-raised text-small" data-testid={tid}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="press flex w-full items-center gap-2 px-3 py-2 text-left text-muted"
			>
				<ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
				<Icon size={14} aria-hidden />
				<span className="font-medium">{title}</span>
				{hint && <span className="min-w-0 flex-1 truncate font-mono text-caption text-faint">{hint}</span>}
			</button>
			{open && <div className="border-t border-hairline px-3 py-2">{children}</div>}
		</div>
	);
}

const brief = (args: unknown) => {
	if (!args || typeof args !== "object") return "";
	const data = args as Record<string, unknown>;
	const options =
		data.options && typeof data.options === "object" ? (data.options as Record<string, unknown>) : undefined;
	const v = data.task ?? options?.task ?? Object.values(data)[0];
	return typeof v === "string" ? v.slice(0, 80) : "";
};

function Tool({ t }: { t: ToolCall }) {
	return (
		<Fold
			icon={Wrench}
			title={t.name}
			hint={brief(t.args)}
			tid="tool-card"
			completed={t.done && ["subagent", "task_run"].includes(t.name)}
		>
			<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-caption text-muted">
				{JSON.stringify(t.args ?? {}, null, 2)}
			</pre>
			{t.result !== undefined && (
				<pre
					className={`mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-caption ${t.isError ? "text-danger" : "text-ink"}`}
				>
					{t.result}
				</pre>
			)}
			{!t.done && <p className="mt-1 text-caption text-faint">执行中…</p>}
		</Fold>
	);
}

/**
 * 通知行的来源显示名：控制台主人是「你」，Bot 用显示名；其他（外部账号、会话 id、未知 Bot）不显示来源。
 * 内部 id 不给用户看，所以这里只认已知规则，认不出就整段省掉。
 */
export function fromLabel(from: string | undefined, names?: ReadonlyMap<string, string>): string | undefined {
	if (!from) return undefined;
	if (from === "acct:console:owner") return "你";
	const bot = /^(?:acct:)?agent:(.+)$/.exec(from)?.[1];
	return bot ? names?.get(bot) : undefined;
}

/** 通知行：来源名已知时写「通知 · 你：」，未知只写「通知：」。 */
function Notice({ it }: { it: ChatItem }) {
	const names = useBotNames();
	const from = fromLabel(it.from, names);
	return (
		<p className="mx-auto text-caption text-faint" data-testid="notice">
			{from ? `通知 · ${from}：${it.text}` : `通知：${it.text}`}
		</p>
	);
}

function ChannelBadge({ it }: { it: ChatItem }) {
	const [open, setOpen] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const enter = () => {
		clearTimeout(timer.current);
		setOpen(true);
	};
	const leave = () => {
		timer.current = setTimeout(() => setOpen(false), 150);
	};
	useEffect(() => () => clearTimeout(timer.current), []);
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger
				aria-label={`${channelName(it.channel)}消息来源`}
				onMouseEnter={enter}
				onMouseLeave={leave}
				onFocus={enter}
				className="absolute -bottom-1.5 -right-1.5 rounded-md border border-ground bg-raised p-0.5"
				data-testid="channel-badge"
			>
				<ChannelIcon channel={it.channel} size={16} />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="top"
					collisionPadding={12}
					onMouseEnter={enter}
					onMouseLeave={leave}
					className="z-50 max-w-[min(360px,calc(100vw-24px))] rounded-control bg-raised p-3 text-small shadow-float"
				>
					<p>
						{channelName(it.channel)}
						{it.fromName ? ` · ${it.fromName}` : ""}
					</p>
					{it.conv && (
						<button
							type="button"
							className="mt-1 break-all text-left text-caption text-muted"
							onClick={() => {
								void navigator.clipboard?.writeText(it.conv!);
							}}
						>
							{it.conv} <Copy size={12} className="inline" />
						</button>
					)}
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

function Bubble({ it, onQuote }: { it: ChatItem; onQuote?: (item: ChatItem) => void }) {
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	const trigger = useMenuTrigger(setMenu);
	const actions: ActionItem[] = [
		{ key: "copy", label: "复制", icon: Copy, onSelect: () => void navigator.clipboard?.writeText(it.text) },
	];
	if (onQuote && it.text) actions.unshift({ key: "quote", label: "引用", icon: Reply, onSelect: () => onQuote(it) });

	if (it.role === "summary")
		return (
			<div
				className="mx-auto w-full max-w-[720px] rounded-control border border-dashed border-hairline bg-tone/50 px-3 py-2"
				data-testid="summary"
			>
				<div className="mb-1 flex items-center gap-1.5 text-caption text-faint">
					<Layers size={13} aria-hidden /> 上下文已压缩 · 摘要
				</div>
				<div className="text-small text-muted">
					<Markdown text={it.text} />
				</div>
			</div>
		);
	if (it.role === "notice") return <Notice it={it} />;
	if (it.role === "tool-result")
		return (
			<div className="mx-auto w-full max-w-[720px]">
				<Fold icon={Wrench} title="工具结果" tid="tool-result">
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-caption">{it.text}</pre>
				</Fold>
			</div>
		);

	const mine = it.role === "user" && !it.triggered && (it.owner || !it.from || it.from === "acct:console:owner");
	const input = it.role === "user";
	const channel = input && it.channel && !["console", "cli"].includes(it.channel);
	return (
		<div
			className={`group/message relative mx-auto flex w-full max-w-[720px] flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}
		>
			{input && !mine && (
				<span className="text-caption text-faint">{it.triggered ? "系统触发" : (it.fromName ?? "外部消息")}</span>
			)}
			{it.thinking && (
				<div className="w-full max-w-[85%]">
					<Fold icon={Brain} title="思考" tid="thinking">
						<p className="whitespace-pre-wrap text-small text-muted">{it.thinking}</p>
					</Fold>
				</div>
			)}
			{it.text && (
				<div className="relative max-w-[85%]">
					{it.metadata && it.metadata.length > 0 && (
						<Popover.Root>
							<Popover.Trigger
								aria-label="消息元数据"
								className="absolute -top-6 right-0 inline-flex items-center gap-1 rounded bg-raised px-1.5 py-0.5 text-caption text-faint opacity-0 focus:opacity-100 group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:none)]:opacity-100"
							>
								<Info size={12} />
								详情
							</Popover.Trigger>
							<Popover.Portal>
								<Popover.Content
									side="top"
									align="end"
									sideOffset={8}
									collisionPadding={12}
									className="z-50 max-h-[50vh] w-[min(420px,calc(100vw-24px))] overflow-auto rounded-card bg-raised p-3 shadow-float"
									aria-label="消息元数据详情"
								>
									{it.metadata.map((part, index) => (
										<section key={`${part.offset}-${part.label}`} className="mb-3 last:mb-0">
											<p className="mb-1 text-caption text-muted">
												{index + 1}. {part.label} · {part.offset === 0 ? "正文前" : `正文第 ${part.offset} 字后`}
											</p>
											<pre className="whitespace-pre-wrap break-all text-caption text-muted">{part.text}</pre>
										</section>
									))}
								</Popover.Content>
							</Popover.Portal>
						</Popover.Root>
					)}
					<div
						{...trigger}
						className={`no-select rounded-bubble px-3.5 py-2 text-body break-words ${mine ? "bg-accent text-on-accent" : it.triggered ? "bg-tone/60 border border-line border-dashed" : "bg-tone"}`}
						data-testid={input ? "bubble-user" : "bubble-bot"}
					>
						<button
							type="button"
							className="sr-only focus:not-sr-only"
							aria-label="消息操作，右键或长按也可打开"
							onClick={(event) => {
								const rect = event.currentTarget.getBoundingClientRect();
								setMenu({ x: rect.left, y: rect.bottom });
							}}
						>
							消息操作
						</button>
						{input ? <p className="whitespace-pre-wrap">{it.text}</p> : <Markdown text={it.text} />}
					</div>
					{channel && <ChannelBadge it={it} />}
				</div>
			)}
			{it.tools.map((t) => (
				<div key={t.id} className="w-full max-w-[85%]">
					<Tool t={t} />
				</div>
			))}
			{it.streaming && <span className="text-caption text-faint">正在输入…</span>}
			{it.ts && (
				<time
					dateTime={new Date(it.ts).toISOString()}
					className="pointer-events-none h-4 px-1 text-caption text-faint opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100"
				>
					{messageClock(it.ts)}
				</time>
			)}
			{menu && <ActionMenu at={menu} title="消息" actions={actions} onClose={() => setMenu(null)} />}
		</div>
	);
}

export function Transcript({
	items,
	hasMore,
	onOlder,
	hasNewer = false,
	onNewer,
	loadingOlder = false,
	olderError,
	onQuote,
	children,
}: {
	items: ChatItem[];
	hasMore: boolean;
	onOlder(): void;
	hasNewer?: boolean;
	onNewer?(): void;
	loadingOlder?: boolean;
	olderError?: string;
	onQuote?(item: ChatItem): void;
	children?: React.ReactNode;
}) {
	// 同一对话来自 ≥2 个渠道时才显示渠道标识
	const box = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const anchor = useRef<{ id: string; top: number } | null>(null);
	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		if (anchor.current) {
			const node = [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
				(node) => node.dataset.messageId === anchor.current?.id,
			);
			if (node) el.scrollTop += node.getBoundingClientRect().top - anchor.current.top;
			anchor.current = null;
		} else if (stick.current && !hasNewer) el.scrollTop = el.scrollHeight;
	});
	const older = () => {
		if (loadingOlder) return;
		const node = box.current?.querySelector<HTMLElement>("[data-message-id]");
		if (node) anchor.current = { id: node.dataset.messageId!, top: node.getBoundingClientRect().top };
		onOlder();
	};
	useEffect(() => {
		const el = box.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, []);
	return (
		<div
			ref={box}
			className="scroll-y min-h-0 flex-1 px-3 py-4"
			onScroll={(e) => {
				const el = e.currentTarget;
				stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
				if (el.scrollTop < 80 && hasMore && !loadingOlder && !olderError) older();
				if (stick.current && hasNewer && !loadingOlder) onNewer?.();
			}}
		>
			<div className="flex flex-col gap-3">
				{hasMore && (
					<button
						type="button"
						disabled={loadingOlder}
						onClick={older}
						className="press mx-auto text-caption text-muted underline"
					>
						{loadingOlder ? "加载中…" : "加载更早的消息"}
					</button>
				)}
				{items.length === 0 && <p className="py-16 text-center text-small text-faint">还没有消息</p>}
				{olderError && (
					<p role="alert" className="text-center text-caption text-danger">
						{olderError}
					</p>
				)}
				{items.map((it, index) => (
					<div key={it.id} data-message-id={it.id}>
						{timeBucket(it.ts, items[index - 1]?.ts) && (
							<p className="my-3 text-center text-caption text-faint">{timeBucket(it.ts, items[index - 1]?.ts)}</p>
						)}
						<Bubble it={it} onQuote={onQuote} />
					</div>
				))}
				{hasNewer && (
					<button
						type="button"
						disabled={loadingOlder}
						onClick={onNewer}
						className="press mx-auto text-caption text-muted underline"
					>
						加载较新的消息
					</button>
				)}
				{children}
			</div>
		</div>
	);
}
