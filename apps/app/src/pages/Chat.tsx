import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bell, Ellipsis, Search, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import type { Actor, Conversation as Conv, Message } from "../api/types";
import { AppBar, BackButton } from "../components/AppBar";
import { AiBadge } from "../components/chat/AiBadge";
import { AnonHint } from "../components/chat/AnonHint";
import { ChatDetail } from "../components/chat/ChatDetail";
import { DeviceRow } from "../components/chat/DeviceRow";
import { EmptyPane } from "../components/EmptyPane";
import { ListHeader } from "../components/ListHeader";
import { Markdown } from "../components/Markdown";
import { PlusMenu } from "../components/PlusMenu";
import { cn } from "../lib/cn";
import { entityRef } from "../lib/entityRef";
import { internalState, useAppBack } from "../lib/navigation";
import { useDesktop } from "../lib/useDesktop";
import { useEntityId } from "../lib/useEntityId";
import { $session } from "../store";
import { Avatar, Status } from "../ui/Avatar";
import { toast } from "../ui/Toast";

const preview = (m?: Message) => {
	if (!m) return "还没有消息";
	const c = m.content;
	return c.type === "text" || c.type === "markdown"
		? c.text.replace(/[#>*`|\n-]+/g, " ").trim()
		: c.type === "interactive"
			? c.title
			: c.type === "image"
				? "[图片]"
				: "[文件]";
};
const clock = (t: number) =>
	new Date(t).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

function useActors(ids: string[]) {
	const key = [...new Set(ids)].sort().join(",");
	const { data } = useQuery({ queryKey: ["actors", key], queryFn: () => api.actors(key ? key.split(",") : []) });
	return useMemo(() => new Map((data ?? []).map((a) => [a.id, a])), [data]);
}

export function ChatShell() {
	const { id } = useParams();
	const qc = useQueryClient();
	const [q, setQ] = useState("");
	const {
		data: convs,
		isLoading,
		isError,
		refetch,
	} = useQuery({ queryKey: ["convs"], queryFn: api.conversations, refetchOnWindowFocus: true });
	const actors = useActors((convs ?? []).flatMap((c) => c.memberIds));
	const me = useStore($session)?.actor;
	const desktop = useDesktop();

	useEffect(
		() =>
			api.subscribe((m) => {
				qc.setQueryData<Message[]>(["msgs", m.convId], (old) =>
					old?.some((x) => x.id === m.id) ? old : [...(old ?? []), m],
				);
				const meId = $session.get()?.actor.id;
				qc.setQueryData<Conv[]>(["convs"], (old) =>
					old?.map((conv) =>
						conv.id === m.convId
							? {
									...conv,
									last: !conv.last || m.seq > conv.last.seq ? m : conv.last,
									unread: m.senderId === meId ? conv.unread : conv.unread + 1,
								}
							: conv,
					),
				);
				qc.invalidateQueries({ queryKey: ["convs"] });
			}),
		[qc],
	);

	const shown = (convs ?? []).filter((c) => c.title.includes(q.trim()));
	return (
		<div className="flex h-full">
			<aside className={cn("w-full shrink-0 flex-col lg:flex lg:w-80", id ? "hidden" : "flex")}>
				{desktop ? (
					<ListHeader q={q} onChange={setQ} />
				) : (
					<>
						<AppBar title={<span className="text-[20px] tracking-tight">消息</span>} right={<PlusMenu />} />
						<div className="px-3 pb-2">
							<label className="field flex h-10 items-center gap-2 rounded-control bg-tone px-3 text-faint">
								<Search size={16} />
								<input
									value={q}
									onChange={(e) => setQ(e.target.value)}
									placeholder="搜索"
									className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
								/>
							</label>
						</div>
					</>
				)}
				<DeviceRow />
				<nav className="scroll-y flex-1 px-2 pb-2">
					{isLoading &&
						Array.from({ length: 4 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 固定数量的加载骨架，没有数据 id
							<div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
								<span className="skeleton h-10 w-10 rounded-full" />
								<span className="flex-1 space-y-2">
									<span className="skeleton block h-3 w-1/2 rounded" />
									<span className="skeleton block h-3 w-4/5 rounded" />
								</span>
							</div>
						))}
					{isError && (
						<p role="status" className="px-3 py-2 text-small text-muted">
							{convs ? "同步失败，仍显示已有会话。" : "会话加载失败。"}
							<button type="button" className="underline" onClick={() => void refetch()}>
								重试
							</button>
						</p>
					)}
					{shown.map((c, i) => (
						<ConvRow
							key={c.id}
							c={c}
							i={i}
							actors={actors}
							meId={me?.id}
							active={!!id && (c.id === id || c.code === id)}
						/>
					))}
					{!isLoading && !isError && !shown.length && (
						<p className="px-3 py-6 text-[14px] text-faint">没有匹配的会话。</p>
					)}
				</nav>
			</aside>
			<main
				className={cn(
					"min-w-0 flex-1 flex-col bg-ground lg:my-2 lg:mr-2 lg:overflow-hidden relative lg:rounded-[24px] lg:shadow-soft lg:flex",
					id ? "flex" : "hidden",
				)}
			>
				{id ? <Outlet /> : <EmptyPane />}
			</main>
		</div>
	);
}

function ConvRow({
	c,
	i,
	actors,
	meId,
	active,
}: {
	c: Conv;
	i: number;
	actors: Map<string, Actor>;
	meId?: string;
	active: boolean;
}) {
	const loc = useLocation();
	const other = c.kind === "dm" ? actors.get(c.memberIds.find((x) => x !== meId) ?? "") : undefined;
	return (
		<Link
			to={`/c/${entityRef(c)}`}
			state={internalState(loc)}
			style={{ "--i": i } as React.CSSProperties}
			className={cn(
				"rise-slow press flex items-center gap-3 rounded-control px-2.5 py-2.5 hover:bg-tone/60",
				active && "bg-raised shadow-soft hover:bg-raised",
			)}
		>
			{other ? (
				<Avatar actor={other} online={other.kind === "agent" ? other.online : undefined} />
			) : (
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tone-2 text-muted">
					{c.kind === "group" ? <Users size={18} /> : <Bell size={18} />}
				</span>
			)}
			<span className="min-w-0 flex-1">
				<span className="flex items-baseline gap-2">
					<span className="flex min-w-0 flex-1 items-center gap-1.5">
						<span className="truncate text-[14px] font-medium">{c.title}</span>
						{other?.kind === "agent" && <AiBadge />}
					</span>
					{c.last && <span className="text-[12px] text-faint">{clock(c.last.createdAt)}</span>}
				</span>
				<span className="block truncate text-[13px] text-muted">{preview(c.last)}</span>
			</span>
			{c.unread > 0 && (
				<span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-[12px] font-medium text-on-accent">
					{c.unread}
				</span>
			)}
		</Link>
	);
}

export function Conversation() {
	const { id: ref } = useParams();
	const resolved = useEntityId("conversation", ref);
	if (resolved.pending)
		return (
			<p role="status" className="p-6 text-muted">
				正在加载会话…
			</p>
		);
	if (resolved.error)
		return (
			<div role="alert" className="p-6 text-muted">
				<p>会话加载失败</p>
				<button type="button" className="underline" onClick={() => void resolved.retry()}>
					重试
				</button>
			</div>
		);
	if (!resolved.id)
		return (
			<div className="p-6 text-muted">
				<p role="status">会话不存在或无法访问</p>
				<Link to="/" className="underline">
					回到消息
				</Link>
			</div>
		);
	return <ConversationBody key={resolved.id} id={resolved.id} routeRef={ref!} />;
}

function ConversationBody({ id, routeRef }: { id: string; routeRef: string }) {
	const qc = useQueryClient();
	const me = useStore($session)?.actor;
	const { data: convs = [] } = useQuery({ queryKey: ["convs"], queryFn: api.conversations });
	const conv = convs.find((c) => c.id === id);
	const {
		data: msgs = [],
		isLoading: loadingMessages,
		isError: messagesError,
		refetch: refreshMessages,
	} = useQuery({ queryKey: ["msgs", id], queryFn: () => api.messages(id) });
	// biome-ignore lint/correctness/useExhaustiveDependencies: 按消息数量与最后序号触发已读
	useEffect(() => {
		const seq = msgs.at(-1)?.seq;
		if (seq !== undefined)
			void api
				.markRead(id, seq)
				.then(() =>
					qc.setQueryData<Conv[]>(["convs"], (old) =>
						old?.map((item) => (item.id === id ? { ...item, unread: 0 } : item)),
					),
				)
				.catch((error) => toast(error instanceof Error ? error.message : "标记已读失败"));
	}, [id, msgs.length, msgs.at(-1)?.seq, qc]);
	const actors = useActors(conv?.memberIds ?? []);
	const loc = useLocation();
	const [params, setParams] = useSearchParams();
	const detail = params.get("detail") === "1";
	const backFromDetail = useAppBack(`/c/${routeRef}`);
	const setDetail = (open: boolean) => {
		if (!open) {
			backFromDetail();
			return;
		}
		const next = new URLSearchParams(params);
		next.set("detail", "1");
		setParams(next, { state: internalState(loc) });
	};
	const end = useRef<HTMLDivElement>(null);
	const [typing, setTyping] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 新消息到达时触发
	useEffect(() => {
		setTyping(false);
	}, [msgs.length]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 新消息或输入提示出现时滚到底
	useEffect(() => {
		end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
	}, [msgs.length, typing]);

	const other = conv?.kind === "dm" ? actors.get(conv.memberIds.find((i) => i !== me?.id) ?? "") : undefined;
	const agentOnline = other?.kind === "agent" && !!other.online;
	const offlineAgent = other?.kind === "agent" && !other.online;
	// biome-ignore lint/correctness/useExhaustiveDependencies: 切换会话时重置
	useEffect(() => {
		if (offlineAgent) toast("Agent 离线，消息会保留，上线后收到");
	}, [offlineAgent, id]);
	return (
		<>
			<AppBar
				left={<BackButton to="/" />}
				title={
					<span className="flex items-center gap-2.5">
						{other && (
							<span className="hidden lg:inline-flex">
								<Avatar actor={other} size={32} />
							</span>
						)}
						<span className="truncate">{conv?.title}</span>
						{other?.kind === "agent" && <AiBadge />}
						{other?.kind === "agent" && (
							<span className="flex items-center gap-1.5 text-[12px] font-normal text-muted">
								<Status online={agentOnline} />
								{agentOnline ? "在线" : "离线"}
							</span>
						)}
					</span>
				}
				right={
					conv &&
					conv.kind !== "notice" && (
						<button
							type="button"
							aria-label="聊天详情"
							onClick={() => setDetail(!detail)}
							className="press flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-tone"
						>
							<Ellipsis size={20} />
						</button>
					)
				}
			/>
			<div className="scroll-y relative z-10 flex-1 px-4">
				<div className="mx-auto flex max-w-[720px] flex-col gap-0.5 py-4">
					{loadingMessages && (
						<p role="status" className="text-small text-muted">
							正在加载消息…
						</p>
					)}
					{messagesError && (
						<p role="status" className="text-small text-muted">
							消息同步失败。
							<button type="button" className="underline" onClick={() => void refreshMessages()}>
								重试
							</button>
						</p>
					)}
					{msgs.map((m, i) => {
						const prev = msgs[i - 1];
						const first = prev?.senderId !== m.senderId;
						const last = msgs[i + 1]?.senderId !== m.senderId;
						return (
							<Bubble
								key={m.id}
								m={m}
								sender={actors.get(m.senderId)}
								mine={m.senderId === me?.id}
								group={conv?.kind === "group"}
								first={first}
								last={last}
							/>
						);
					})}
					{typing && <Typing />}
					{me?.anonymous && <AnonHint sent={msgs.filter((m) => m.senderId === me.id).length} />}
					<div ref={end} />
				</div>
			</div>
			{conv?.kind !== "notice" && (
				<Composer
					key={id}
					convId={id}
					offline={other?.kind === "agent" && !agentOnline}
					onSend={() => agentOnline && setTyping(true)}
				/>
			)}
			{detail && <ChatDetail convId={id} onClose={() => setDetail(false)} />}
		</>
	);
}

function Typing() {
	return (
		<div
			className="fade mt-2 inline-flex w-fit items-center gap-1 rounded-bubble bg-tone px-3.5 py-3"
			role="status"
			aria-label="对方正在输入"
		>
			{[0, 1, 2].map((i) => (
				<span
					key={i}
					className="dot-hop h-1.5 w-1.5 rounded-full bg-muted"
					style={{ "--i": i } as React.CSSProperties}
				/>
			))}
		</div>
	);
}

function Bubble({
	m,
	sender,
	mine,
	group,
	first,
	last,
}: {
	m: Message;
	sender?: Actor;
	mine: boolean;
	group: boolean;
	first: boolean;
	last: boolean;
}) {
	const loc = useLocation();
	const c = m.content;
	const tight = mine
		? { borderTopRightRadius: first ? undefined : 6, borderBottomRightRadius: last ? undefined : 6 }
		: { borderTopLeftRadius: first ? undefined : 6, borderBottomLeftRadius: last ? undefined : 6 };
	return (
		<div className={cn("rise flex items-end gap-2", mine && "flex-row-reverse", first && "mt-3")}>
			{!mine && (
				<span className="w-8 shrink-0">
					{last && sender && (
						<Link
							to={`/contacts/${entityRef(sender)}`}
							state={internalState(loc)}
							aria-label={`查看${sender.name}的资料`}
						>
							<Avatar actor={sender} size={32} />
						</Link>
					)}
				</span>
			)}
			<div className={cn("flex max-w-[80%] flex-col gap-1", mine && "items-end")}>
				{group && !mine && first && sender && (
					<span className="px-1 text-[12px] text-muted">
						{sender.name}
						{sender.kind === "agent" && " · Agent"}
					</span>
				)}
				<div
					style={tight}
					className={cn("rounded-bubble px-3.5 py-2 text-[15px]", mine ? "bg-accent text-on-accent" : "bg-tone")}
				>
					{c.type === "text" && <p className="whitespace-pre-wrap">{c.text}</p>}
					{c.type === "markdown" && <Markdown text={c.text} />}
					{c.type === "image" && <img src={c.url} alt={c.name ?? ""} className="max-h-64 rounded-xl" />}
					{c.type === "file" && (
						<a href={c.url} className="underline underline-offset-2">
							{c.name}
						</a>
					)}
					{c.type === "interactive" && (
						<div className="flex flex-col gap-2 py-0.5">
							<b className="font-semibold">{c.title}</b>
							<p className="text-muted">{c.body}</p>
							<div className="flex gap-2">
								{c.actions.map((a) => (
									<Link
										key={a.id}
										to={c.link ?? "#"}
										className="press inline-flex h-8 items-center rounded-full bg-accent px-3 text-[13px] font-medium text-on-accent"
									>
										{a.label}
									</Link>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function Composer({ convId, offline, onSend }: { convId: string; offline: boolean; onSend: () => void }) {
	const [text, setText] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	const qc = useQueryClient();
	const [sending, setSending] = useState(false);
	const pending = useRef(false);
	const send = async () => {
		const t = text.trim();
		if (!t || pending.current) return;
		pending.current = true;
		setSending(true);
		try {
			const message = await api.send(convId, { type: "markdown", text: t });
			qc.setQueryData<Message[]>(["msgs", convId], (old) =>
				old?.some((m) => m.id === message.id) ? old : [...(old ?? []), message],
			);
			void qc.invalidateQueries({ queryKey: ["convs"] });
			setText("");
			if (ref.current) ref.current.style.height = "";
			onSend();
		} catch (error) {
			toast(error instanceof Error ? error.message : "发送失败，请重试", true);
		} finally {
			pending.current = false;
			setSending(false);
		}
	};
	return (
		<div className="shrink-0 px-4 pb-safe">
			<div className="field mx-auto flex max-w-[720px] items-end gap-2 rounded-[20px] bg-raised p-2 pl-4 shadow-float">
				<textarea
					ref={ref}
					value={text}
					readOnly={sending}
					rows={1}
					placeholder={offline ? "Agent 离线，消息会保留" : "输入消息"}
					onChange={(e) => {
						setText(e.target.value);
						e.target.style.height = "auto";
						e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							send();
						}
					}}
					className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-faint"
				/>
				<button
					type="button"
					onClick={send}
					disabled={!text.trim() || sending}
					aria-label={sending ? "发送中" : "发送"}
					className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:bg-tone-2 disabled:text-faint"
				>
					{sending ? <span className="text-[11px]">发送中</span> : <ArrowUp size={18} strokeWidth={2.25} />}
				</button>
			</div>
		</div>
	);
}
