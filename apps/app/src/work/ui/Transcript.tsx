import { Brain, ChevronRight, Copy, Layers, Wrench } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChannelIcon } from "../features/messages/ChannelIcon";
import type { ActionItem } from "../lib/actions";
import { type ChatItem, channelName, type ToolCall } from "../lib/chat";
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
}: {
	icon: typeof Wrench;
	title: string;
	hint?: string;
	children: React.ReactNode;
	tid: string;
}) {
	const [open, setOpen] = useState(false);
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
	const v = Object.values(args as Record<string, unknown>)[0];
	return typeof v === "string" ? v.slice(0, 80) : "";
};

function Tool({ t }: { t: ToolCall }) {
	return (
		<Fold icon={Wrench} title={t.name} hint={brief(t.args)} tid="tool-card">
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

function Bubble({ it, showChannel }: { it: ChatItem; showChannel: boolean }) {
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	const trigger = useMenuTrigger(setMenu);
	const actions: ActionItem[] = [
		{ key: "copy", label: "复制", icon: Copy, onSelect: () => void navigator.clipboard?.writeText(it.text) },
	];

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

	const mine = it.role === "user";
	return (
		<div className={`mx-auto flex w-full max-w-[720px] flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}>
			{mine && showChannel && (
				<span className="flex max-w-full items-center gap-1 text-caption text-faint" data-testid="channel-badge">
					<ChannelIcon channel={it.channel} size={14} />
					{channelName(it.channel)}
					{it.fromName && <span className="truncate text-faint">· {it.fromName}</span>}
				</span>
			)}
			{it.thinking && (
				<div className="w-full max-w-[85%]">
					<Fold icon={Brain} title="思考" tid="thinking">
						<p className="whitespace-pre-wrap text-small text-muted">{it.thinking}</p>
					</Fold>
				</div>
			)}
			{it.text && (
				<div
					{...trigger}
					className={`no-select max-w-[85%] rounded-bubble px-3.5 py-2 text-body break-words ${mine ? "bg-accent text-on-accent" : "bg-tone"}`}
					data-testid={mine ? "bubble-user" : "bubble-bot"}
				>
					{mine ? <p className="whitespace-pre-wrap">{it.text}</p> : <Markdown text={it.text} />}
				</div>
			)}
			{it.tools.map((t) => (
				<div key={t.id} className="w-full max-w-[85%]">
					<Tool t={t} />
				</div>
			))}
			{it.streaming && <span className="text-caption text-faint">正在输入…</span>}
			{menu && <ActionMenu at={menu} title="消息" actions={actions} onClose={() => setMenu(null)} />}
		</div>
	);
}

export function Transcript({
	items,
	hasMore,
	onOlder,
	children,
}: {
	items: ChatItem[];
	hasMore: boolean;
	onOlder(): void;
	children?: React.ReactNode;
}) {
	// 同一对话来自 ≥2 个渠道时才显示渠道标识
	const channels = new Set(items.filter((i) => i.role === "user").map((i) => channelName(i.channel))).size >= 2;
	const box = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	useLayoutEffect(() => {
		const el = box.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	});
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
			}}
		>
			<div className="flex flex-col gap-3">
				{hasMore && (
					<button type="button" onClick={onOlder} className="press mx-auto text-caption text-muted underline">
						加载更早的消息
					</button>
				)}
				{items.length === 0 && <p className="py-16 text-center text-small text-faint">还没有消息</p>}
				{items.map((it) => (
					<Bubble key={it.id} it={it} showChannel={channels} />
				))}
				{children}
			</div>
		</div>
	);
}
