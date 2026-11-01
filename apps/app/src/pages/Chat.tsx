import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Bell, BellOff, Check, Copy, Ellipsis, Pin, Reply, Search, Users } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { chatApi, chatError } from "../api/chat";
import type { Actor, Conversation as Conv, Message, Session } from "../api/types";
import { selectAccount } from "../cache";
import { AppBar, BackButton } from "../components/AppBar";
import { AiBadge } from "../components/chat/AiBadge";
import { AnonHint } from "../components/chat/AnonHint";
import { ChatDetail } from "../components/chat/ChatDetail";
import { OwnerTranscript, useOwnerConversation } from "../components/chat/OwnerTranscript";
import { PinnedMessages } from "../components/chat/PinnedMessages";
import { SocialPresence } from "../components/chat/SocialPresence";
import { ListHeader } from "../components/ListHeader";
import { Markdown } from "../components/Markdown";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { PlusMenu } from "../components/PlusMenu";
import { VerifySheet } from "../components/VerifySheet";
import { useChatBackground } from "../lib/chatBackground";
import { readConversation } from "../lib/chatRead";
import { cn } from "../lib/cn";
import { convRowMenu } from "../lib/convMenu";
import { entityRef, isShortCode } from "../lib/entityRef";
import { groupMemberName } from "../lib/groupMemberName";
import { editedMentions, type MentionToken, mentionMetadata, mentionQuery } from "../lib/mentions";
import { internalState, useAppBack } from "../lib/navigation";
import { historyScrollBehavior, useNewMessages } from "../lib/newMessages";
import { clearPendingSend, savePendingSend, takePendingSend } from "../lib/pendingSend";
import { usePersonalAgent } from "../lib/personalAgent";
import { socialUnavailable } from "../lib/socialError";
import { useDesktop } from "../lib/useDesktop";
import { useEntityId } from "../lib/useEntityId";
import { needsVerify } from "../lib/verify";
import { readMarketDraft } from "../market/handoff";
import { $session } from "../store";
import { Avatar, GroupAvatar, Status } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { messageClock, timeBucket } from "../work/lib/chat";
import {
	markRead as markReadPref,
	setLevel as setLevelPref,
	togglePin as togglePinPref,
	usePrefs,
} from "../work/lib/prefs";
import { type MenuAnchor, useMenuTrigger } from "../work/lib/useLongPress";
import { ActionMenu } from "../work/ui/ActionMenu";

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

/** Bot 离线统一文案：横幅、输入框占位、进入会话与发送后的提示共用这一句。 */
const OFFLINE_HINT = "Bot 离线，消息会在上线后送达";

/** 没有会话时的空态：不自动跳转，点「开始聊天」才开与默认 Bot 的私聊（B5：/ 可达、可刷新）。 */
function EmptyChats({ onStart, busy }: { onStart: () => void; busy: boolean }) {
	return (
		<div className="m-auto flex max-w-xs flex-col items-center px-6 py-10 text-center">
			<p className="text-title font-semibold tracking-tight">还没有会话</p>
			<p className="mt-2 text-small text-muted">和你的 Bot 说句话，会话会出现在这里。</p>
			<Button variant="primary" className="mt-5" disabled={busy} onClick={onStart}>
				{busy ? "正在打开…" : "开始聊天"}
			</Button>
		</div>
	);
}

function useActors(ids: string[]) {
	const key = [...new Set(ids)].sort().join(",");
	// 在线态每 15 秒刷新一次（窗口可见时），设备断开后聊天页不会长期显示「在线」。
	const { data } = useQuery({
		queryKey: ["actors", key],
		queryFn: () => api.actors(key ? key.split(",") : []),
		refetchInterval: 15_000,
	});
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
		error,
		refetch,
	} = useQuery({ queryKey: ["convs"], queryFn: api.conversations, refetchOnWindowFocus: true });
	const actors = useActors((convs ?? []).flatMap((c) => c.memberIds));
	const me = useStore($session)?.actor;
	const desktop = useDesktop();
	const nav = useNavigate();
	const { agent: defaultBot } = usePersonalAgent();
	const defaultConv = defaultBot && convs?.find((c) => c.kind === "dm" && c.memberIds.includes(defaultBot.id));
	// 不自动跳进任何会话（B5）：没有会话时显示空态，点「开始聊天」才建/开与默认 Bot 的私聊。
	const botId = defaultBot?.id;
	const [starting, setStarting] = useState(false);
	const startChat = async () => {
		if (starting) return;
		if (defaultConv) {
			nav(`/c/${entityRef(defaultConv)}`);
			return;
		}
		if (!botId) {
			nav("/work");
			return;
		}
		setStarting(true);
		try {
			const conv = await api.openDm(botId);
			await qc.invalidateQueries({ queryKey: ["convs"] });
			nav(`/c/${entityRef(conv)}`);
		} catch (error) {
			toast(error instanceof Error ? error.message : "无法开始会话", true);
		} finally {
			setStarting(false);
		}
	};

	useEffect(
		() =>
			api.subscribe((m) => {
				qc.setQueryData<Message[]>(["msgs", m.convId], (old) =>
					old?.some((x) => x.id === m.id) || (old?.length && (old.at(-1)?.seq ?? m.seq) < m.seq - 1)
						? old
						: [...(old ?? []), m].slice(-120),
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

	useEffect(() => {
		const refresh = () => {
			void qc.invalidateQueries({ queryKey: ["actors"] });
			void qc.invalidateQueries({ queryKey: ["convs"] });
		};
		window.addEventListener("yonder:presence", refresh);
		return () => window.removeEventListener("yonder:presence", refresh);
	}, [qc]);

	const noSocial = isError && !convs && socialUnavailable(error);
	// 置顶的会话排在前面，其余保持接口给的顺序。
	const pinnedIds = usePrefs().pinned;
	const shown = (convs ?? [])
		.filter((c) => c.title.includes(q.trim()))
		.sort((a, b) => Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)));
	return (
		<div className="flex h-full">
			<aside className={cn("w-full shrink-0 flex-col lg:flex lg:w-80", id ? "hidden" : "flex")}>
				{desktop ? (
					<ListHeader q={q} onChange={setQ} />
				) : (
					<>
						<AppBar
							title={<span className="text-title tracking-tight">{me?.name}</span>}
							left={<PersonalAvatar />}
							right={<PlusMenu />}
						/>
						<div className="px-3 pb-2">
							<label className="field flex h-10 items-center gap-2 rounded-control bg-tone px-3 text-faint">
								<Search size={16} aria-hidden />
								<input
									value={q}
									onChange={(e) => setQ(e.target.value)}
									placeholder="搜索"
									aria-label="搜索消息"
									className="min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-faint"
								/>
							</label>
						</div>
					</>
				)}
				<nav aria-label="消息列表" className="scroll-y flex-1 px-2 pb-2">
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
							{convs ? "同步失败，仍显示已有会话。" : noSocial ? "当前节点没有提供社交服务。" : "会话加载失败。"}
							<button type="button" className="underline" onClick={() => void refetch()}>
								重试
							</button>
						</p>
					)}
					{shown.map((c) => (
						<ConvRow key={c.id} c={c} actors={actors} meId={me?.id} active={!!id && (c.id === id || c.code === id)} />
					))}
					{!isLoading && !isError && !convs?.length && <EmptyChats onStart={() => void startChat()} busy={starting} />}
					{!isLoading && !isError && !!convs?.length && !shown.length && (
						<p className="px-3 py-6 text-small text-faint">没有匹配的会话。</p>
					)}
				</nav>
			</aside>
			<main
				className={cn(
					"min-w-0 flex-1 flex-col bg-ground lg:my-2 lg:mr-2 lg:overflow-hidden relative lg:rounded-panel lg:shadow-soft lg:flex",
					id ? "flex" : "hidden",
				)}
			>
				{id ? (
					<Outlet />
				) : convs?.length ? (
					<Users aria-hidden="true" className="m-auto text-faint" size={32} />
				) : !isLoading && !isError ? (
					<EmptyChats onStart={() => void startChat()} busy={starting} />
				) : null}
			</main>
		</div>
	);
}

function ConvRow({ c, actors, meId, active }: { c: Conv; actors: Map<string, Actor>; meId?: string; active: boolean }) {
	const loc = useLocation();
	const qc = useQueryClient();
	const prefs = usePrefs();
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	const trigger = useMenuTrigger(setMenu);
	const other = c.kind === "dm" ? actors.get(c.memberIds.find((x) => x !== meId) ?? "") : undefined;
	const level = prefs.level[c.id] ?? "all";
	const pinned = prefs.pinned.includes(c.id);
	// 标为已读同时落到服务端（未读数是服务端字段），本地偏好只记住读到哪。
	const markRead = () => {
		const seq = c.last?.seq;
		if (seq === undefined) return;
		void api
			.markRead(c.id, seq)
			.then(() =>
				qc.setQueryData<Conv[]>(["convs"], (old) => old?.map((x) => (x.id === c.id ? readConversation(x, seq) : x))),
			)
			.catch((error) => toast(error instanceof Error ? error.message : "标记已读失败", true));
		markReadPref(c.id, seq);
	};
	const actions = convRowMenu({
		pinned,
		level,
		pin: () => togglePinPref(c.id),
		setLevel: (next) => setLevelPref(c.id, next),
		markRead,
	});
	return (
		<>
			<Link
				to={`/c/${entityRef(c)}`}
				state={internalState(loc)}
				data-selected={active || undefined}
				{...trigger}
				className={cn(
					"social-conv-row press no-select flex items-center gap-3 rounded-control px-3 py-3",
					active ? "bg-accent text-on-accent hover:bg-accent" : "hover:bg-tone/60",
					!active && pinned && "bg-tone/40",
				)}
			>
				{other ? (
					<Avatar actor={other} online={other.kind === "agent" ? other.online : undefined} />
				) : (
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tone-2 text-muted">
						{c.kind === "group" ? <GroupAvatar url={c.avatarUrl} title={c.title} size={40} /> : <Bell size={18} />}
					</span>
				)}
				<span className="min-w-0 flex-1">
					<span className="flex items-baseline gap-2">
						<span className="flex min-w-0 flex-1 items-center gap-1.5">
							<span className="truncate text-small font-medium">{c.title}</span>
							{other?.kind === "agent" && (
								<AiBadge actor={other} className={active ? "bg-on-accent/20 text-on-accent" : undefined} />
							)}
							{level === "mute" && (
								<BellOff
									size={13}
									className={cn("shrink-0", active ? "text-on-accent/80" : "text-faint")}
									aria-label="免打扰"
								/>
							)}
						</span>
						{pinned && (
							<Pin
								size={12}
								className={cn("shrink-0", active ? "text-on-accent/80" : "text-faint")}
								aria-label="已置顶"
							/>
						)}
						{c.last && (
							<span className={cn("text-caption", active ? "text-on-accent/80" : "text-faint")}>
								{clock(c.last.createdAt)}
							</span>
						)}
					</span>
					<span className={cn("block truncate text-small", active ? "text-on-accent/90" : "text-muted")}>
						{c.mentionUnread && (
							<span className={cn("mr-1 font-medium", active ? "text-on-accent" : "text-danger")}>[有人@我]</span>
						)}
						{preview(c.last)}
					</span>
				</span>
				{c.unread > 0 && (
					<span
						className={cn(
							"min-w-5 rounded-full px-1.5 text-center text-caption font-medium",
							active ? "bg-ground text-accent-ink" : "bg-accent text-on-accent",
						)}
					>
						{c.unread}
					</span>
				)}
			</Link>
			{menu && <ActionMenu at={menu} title={c.title} actions={actions} onClose={() => setMenu(null)} />}
		</>
	);
}

const forbidden = (error: unknown) => (error as { status?: number } | null)?.status === 403;

/** 会话路由只认短码与 UUID；mock 会话 id 形如 c-1。其他路径按「页面不存在」处理。 */
const routableConversation = (ref: string) =>
	isShortCode(ref) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref) || /^c-/.test(ref);

export function Conversation() {
	const { id: ref } = useParams();
	const resolved = useEntityId("conversation", ref);
	if (ref && !routableConversation(ref))
		return (
			<div className="flex h-full flex-col items-center justify-center gap-4 p-6">
				<h1 className="text-title font-semibold">会话不存在或无法访问</h1>
				<Link to="/" className="text-small underline">
					回到消息
				</Link>
			</div>
		);
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

export function ConversationBody({ id, routeRef }: { id: string; routeRef: string }) {
	const qc = useQueryClient();
	const me = useStore($session)?.actor;
	const { data: convs = [] } = useQuery({ queryKey: ["convs"], queryFn: api.conversations });
	const conv = convs.find((c) => c.id === id);
	const { data: groupDetail } = useQuery({
		queryKey: ["conv-detail", id],
		queryFn: () => api.conversationDetail(id),
		enabled: conv?.kind === "group",
	});
	const role = groupDetail?.members.find((m) => m.id === me?.id)?.role;
	const manageGroup = conv?.kind === "group" && !me?.anonymous && (role === "owner" || role === "admin");
	const [groupSaving, setGroupSaving] = useState(false);
	const groupPending = useRef(false);
	const saveGroup = async (action: () => Promise<void>) => {
		if (groupPending.current) return;
		groupPending.current = true;
		setGroupSaving(true);
		try {
			await action();
			await qc.invalidateQueries({ queryKey: ["conv-detail", id] });
		} catch (e) {
			toast(chatError(e), true);
		} finally {
			groupPending.current = false;
			setGroupSaving(false);
		}
	};
	useEffect(() => {
		const refresh = () => void qc.invalidateQueries({ queryKey: ["conv-detail", id] });
		window.addEventListener("yonder:presence", refresh);
		return () => window.removeEventListener("yonder:presence", refresh);
	}, [qc, id]);
	const [oldestSeen, setOldestSeen] = useState<number>();
	const {
		data: messageData = [],
		isLoading: loadingMessages,
		isError: messagesError,
		error: messagesFailure,
		refetch: refreshMessages,
	} = useQuery({
		queryKey: ["msgs", id],
		queryFn: async () => {
			const page = await api.messages(id, { limit: 80 });
			if (page.length < 80) setOldestSeen((oldest) => Math.min(oldest ?? Infinity, page[0]?.seq ?? 0));
			return page.slice(-120);
		},
		refetchOnWindowFocus: false,
		retry: (n, e) => !forbidden(e) && n < 3,
	});
	const msgs = messageData.length > 120 ? messageData.slice(-120) : messageData;
	const newMessages = useNewMessages(messageData);
	const background = useChatBackground(me?.id, id);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 按消息数量与最后序号触发已读
	useEffect(() => {
		const seq = msgs.at(-1)?.seq;
		if (seq !== undefined)
			void api
				.markRead(id, seq)
				.then(() =>
					qc.setQueryData<Conv[]>(["convs"], (old) =>
						old?.map((item) => (item.id === id ? readConversation(item, seq) : item)),
					),
				)
				.catch((error) => toast(error instanceof Error ? error.message : "标记已读失败"));
	}, [id, msgs.length, msgs.at(-1)?.seq, qc]);
	const globalActors = useActors(conv?.memberIds ?? []);
	const actors = useMemo(() => {
		if (conv?.kind !== "group" || !groupDetail) return globalActors;
		const scoped = new Map(globalActors);
		for (const member of groupDetail.members)
			scoped.set(member.id, { ...(globalActors.get(member.id) ?? member), name: groupMemberName(member) });
		return scoped;
	}, [globalActors, groupDetail, conv?.kind]);
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
	const scroll = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const anchor = useRef<{ id: string; top: number; messages: Message[] } | null>(null);
	const pendingPage = useRef(false);
	const [paging, setPaging] = useState(false);
	const hasOlder = !!msgs.length && (oldestSeen === undefined || msgs[0].seq > oldestSeen);
	const hasNewer = (conv?.last?.seq ?? 0) > (msgs.at(-1)?.seq ?? 0);
	const moveWindow = async (older: boolean) => {
		if (pendingPage.current || !msgs.length) return;
		pendingPage.current = true;
		stick.current = false;
		setPaging(true);
		const box = scroll.current;
		const row =
			box &&
			[...box.querySelectorAll<HTMLElement>("[data-message-id]")].find(
				(el) => el.getBoundingClientRect().bottom > box.getBoundingClientRect().top + 60,
			);
		anchor.current = row?.dataset.messageId
			? { id: row.dataset.messageId, top: row.getBoundingClientRect().top, messages: msgs }
			: null;
		try {
			const page = await api.messages(id, {
				limit: 40,
				...(older ? { before: msgs[0].seq } : { since: msgs[msgs.length - 1].seq }),
			});
			if (older && page.length < 40) setOldestSeen(page[0]?.seq ?? msgs[0].seq);
			qc.setQueryData<Message[]>(["msgs", id], (old = []) => {
				const merged = [...new Map([...old, ...page].map((message) => [message.id, message])).values()].sort(
					(a, b) => a.seq - b.seq,
				);
				return older ? merged.slice(0, 120) : merged.slice(-120);
			});
		} catch (error) {
			anchor.current = null;
			toast(error instanceof Error ? error.message : "消息加载失败", true);
		} finally {
			pendingPage.current = false;
			setPaging(false);
		}
	};
	useLayoutEffect(() => {
		const box = scroll.current;
		if (!box || !anchor.current || anchor.current.messages === msgs) return;
		const saved = anchor.current;
		const row = [...box.querySelectorAll<HTMLElement>("[data-message-id]")].find(
			(el) => el.dataset.messageId === saved.id,
		);
		if (row) box.scrollTop += row.getBoundingClientRect().top - saved.top;
		anchor.current = null;
	});
	const [focusedMessage, setFocusedMessage] = useState<string>();
	const jumpToMessage = async (message: Message) => {
		stick.current = false;
		anchor.current = null;
		try {
			if (!msgs.some((m) => m.id === message.id)) {
				const [before, after] = await Promise.all([
					api.messages(id, { before: message.seq, limit: 40 }),
					api.messages(id, { since: message.seq - 1, limit: 40 }),
				]);
				qc.setQueryData<Message[]>(
					["msgs", id],
					[...new Map([...before, ...after].map((m) => [m.id, m])).values()].sort((a, b) => a.seq - b.seq),
				);
			}
			setFocusedMessage(message.id);
		} catch (e) {
			toast(e instanceof Error ? e.message : "无法定位消息", true);
		}
	};
	useEffect(() => {
		if (!focusedMessage) return;
		const row = scroll.current?.querySelector<HTMLElement>(`[data-message-id="${focusedMessage}"]`);
		row?.scrollIntoView({ block: "center", behavior: historyScrollBehavior() });
		const timer = setTimeout(() => setFocusedMessage(undefined), 3000);
		return () => clearTimeout(timer);
	}, [focusedMessage]);
	const [typing, setTyping] = useState(false);
	const [reply, setReply] = useState<Message>();
	const [quoteText, setQuoteText] = useState<string>();
	// biome-ignore lint/correctness/useExhaustiveDependencies: 新消息到达时触发
	useEffect(() => {
		setTyping(false);
	}, [msgs.length]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 新消息或输入提示出现时滚到底
	useEffect(() => {
		if (stick.current && !hasNewer && !anchor.current) end.current?.scrollIntoView({ block: "end" });
	}, [msgs.length, typing]);

	const other = conv?.kind === "dm" ? actors.get(conv.memberIds.find((i) => i !== me?.id) ?? "") : undefined;
	const owner = useOwnerConversation(other, me?.id);
	const ownerBinding = owner.data;
	const ownerEligible = other?.kind === "agent" && other.ownerId === me?.id && !!other.deviceId;
	const agentOnline = other?.kind === "agent" && !!other.online;
	// 云端 Bot（小歪）没有设备，不能显示「电脑离线」：只有绑了设备的 Agent 才提示离线。
	const cloudBot = other?.kind === "agent" && !other.deviceId && other.ownerId === me?.id;
	const offlineAgent = other?.kind === "agent" && !other.online && !cloudBot;
	// biome-ignore lint/correctness/useExhaustiveDependencies: 切换会话时重置
	useEffect(() => {
		if (offlineAgent) toast(OFFLINE_HINT);
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
						{conv?.kind === "group" && <GroupAvatar url={conv.avatarUrl} title={conv.title} size={32} />}
						<span className="truncate">{conv?.title}</span>
						{other?.kind === "agent" && <AiBadge actor={other} />}
						{other?.kind === "agent" && (
							<span className="flex items-center gap-1.5 text-caption font-normal text-muted">
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
			{groupDetail && (
				<PinnedMessages
					messages={groupDetail.pinnedMessages ?? []}
					announcement={groupDetail.announcement}
					manage={!!manageGroup && !groupSaving}
					onSelect={(m) => void jumpToMessage(m)}
					onRemove={(m) => void saveGroup(() => chatApi.unpinMessage(id, m.id))}
					onClear={() => void saveGroup(() => chatApi.setAnnouncement(id, null))}
				/>
			)}
			{ownerEligible && !ownerBinding && (owner.isFetching || owner.error) && (
				<p role="status" className="px-4 py-2 text-caption text-muted">
					{owner.isFetching ? "正在同步完整会话…" : "完整会话暂不可用，当前显示聊天消息"}
				</p>
			)}
			{ownerBinding ? (
				<OwnerTranscript binding={ownerBinding} onQuote={setQuoteText} backgroundStyle={background.style} />
			) : (
				<div
					ref={scroll}
					style={background.style}
					data-chat-background={background.style.backgroundImage ? "image" : undefined}
					className="social-chat-canvas scroll-y relative z-10 flex-1 px-4"
					onScroll={(event) => {
						const el = event.currentTarget;
						stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
						if (el.scrollTop < 48 && hasOlder) void moveWindow(true);
						else if (stick.current && hasNewer) void moveWindow(false);
					}}
				>
					<div className="mx-auto flex max-w-[720px] flex-col gap-0.5 py-4">
						{loadingMessages && (
							<p role="status" className="text-small text-muted">
								正在加载消息…
							</p>
						)}
						{messagesError && forbidden(messagesFailure) && (
							<p role="status" className="text-small text-muted">
								无权访问这个会话
							</p>
						)}
						{messagesError && !forbidden(messagesFailure) && (
							<p role="status" className="text-small text-muted">
								消息同步失败。
								<button type="button" className="underline" onClick={() => void refreshMessages()}>
									重试
								</button>
							</p>
						)}
						{hasOlder && (
							<button
								disabled={paging}
								type="button"
								className="mx-auto py-2 text-caption text-muted"
								onClick={() => void moveWindow(true)}
							>
								{paging ? "正在加载…" : "加载更早的消息"}
							</button>
						)}
						{msgs.map((m, i) => {
							const prev = msgs[i - 1];
							const bucket = timeBucket(m.createdAt, prev?.createdAt);
							const first = !!bucket || prev?.senderId !== m.senderId;
							const last = msgs[i + 1]?.senderId !== m.senderId;
							return (
								<Fragment key={m.id}>
									{bucket && <p className="social-date-label py-4 text-center text-caption text-faint">{bucket}</p>}
									<Bubble
										m={m}
										animate={newMessages.has(m.id)}
										highlighted={focusedMessage === m.id}
										pinned={groupDetail?.pinnedMessages?.some((p) => p.id === m.id)}
										onPin={
											manageGroup && !groupSaving
												? () =>
														void saveGroup(() =>
															groupDetail?.pinnedMessages?.some((p) => p.id === m.id)
																? chatApi.unpinMessage(id, m.id)
																: chatApi.pinMessage(id, m.id),
														)
												: undefined
										}
										onAnnounce={
											manageGroup && !groupSaving
												? () => {
														if (window.confirm("将这条消息设为群公告？"))
															void saveGroup(() => chatApi.setAnnouncement(id, m.id));
													}
												: undefined
										}
										replied={msgs.find((item) => item.id === m.replyTo)}
										actors={actors}
										onReply={() => setReply(m)}
										sender={actors.get(m.senderId)}
										mine={m.senderId === me?.id}
										group={conv?.kind === "group"}
										first={first}
										last={last}
									/>
								</Fragment>
							);
						})}
						{hasNewer && (
							<button
								disabled={paging}
								type="button"
								className="mx-auto py-2 text-caption text-muted"
								onClick={() => void moveWindow(false)}
							>
								加载更新的消息
							</button>
						)}
						{typing && <Typing />}
						{me?.anonymous && <AnonHint sent={msgs.filter((m) => m.senderId === me.id).length} />}
						<div ref={end} />
					</div>
				</div>
			)}
			{offlineAgent && <p className="mx-auto mb-2 text-center text-small text-muted">{OFFLINE_HINT}</p>}
			{conv?.kind !== "notice" && (
				<Composer
					key={id}
					convId={id}
					mutedUntil={groupDetail?.selfMutedUntil ?? conv?.selfMutedUntil}
					members={conv?.kind === "group" ? [...actors.values()].filter((a) => a.id !== me?.id) : []}
					reply={reply}
					quoteText={quoteText}
					onClearQuote={() => setQuoteText(undefined)}
					onClearReply={() => setReply(undefined)}
					offline={offlineAgent}
					agentId={other?.kind === "agent" ? other.id : undefined}
					cloudBot={cloudBot}
					onSend={() => {
						stick.current = true;
						if (agentOnline) setTyping(true);
					}}
				/>
			)}
			<SocialPresence open={detail}>
				<ChatDetail
					convId={id}
					onClose={() => setDetail(false)}
					onSelectMessage={(m: Message) => void jumpToMessage(m)}
				/>
			</SocialPresence>
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

export function Bubble({
	m,
	replied,
	actors,
	onReply,
	sender,
	mine,
	group,
	first,
	last,
	animate,
	highlighted,
	pinned,
	onPin,
	onAnnounce,
}: {
	animate?: boolean;
	highlighted?: boolean;
	pinned?: boolean;
	onPin?: () => void;
	onAnnounce?: () => void;
	m: Message;
	replied?: Message;
	actors: Map<string, Actor>;
	onReply: () => void;
	sender?: Actor;
	mine: boolean;
	group: boolean;
	first: boolean;
	last: boolean;
}) {
	const loc = useLocation();
	const c = m.content;
	const selfId = useStore($session)?.actor.id;
	const mentioned =
		!mine && (c.type === "text" || c.type === "markdown") && (c.mentionAll || c.mentions?.includes(selfId ?? ""));
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	// 复制后的对勾微弹出现，2.5 秒后淡出恢复（.pop / .feedback，见 styles.css）
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 2500);
		return () => window.clearTimeout(timer);
	}, [copied]);
	const trigger = useMenuTrigger(setMenu);
	const copy = () => {
		const text = "text" in c ? c.text : "url" in c ? c.url : c.title;
		void navigator.clipboard
			.writeText(text)
			.then(() => setCopied(true))
			.catch(() => toast("复制失败", true));
	};
	const tight = mine
		? { borderTopRightRadius: first ? undefined : 6, borderBottomRightRadius: last ? undefined : 6 }
		: { borderTopLeftRadius: first ? undefined : 6, borderBottomLeftRadius: last ? undefined : 6 };
	return (
		<div
			data-message-id={m.id}
			data-new-message={animate || undefined}
			data-mine={mine}
			className={cn(
				"social-message group/message flex w-full items-end gap-2",
				mine && "flex-row-reverse",
				first && "mt-3",
				highlighted && "rounded-control bg-tone-2 ring-2 ring-accent/30",
			)}
		>
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
					<span className="social-sender-label px-1 text-caption text-muted">
						{sender.name}
						{sender.kind === "agent" && " · Bot"}
					</span>
				)}
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
				<div
					{...trigger}
					style={tight}
					className={cn(
						"rounded-bubble px-3.5 py-2 text-body",
						mine ? "bg-accent text-on-accent" : "bg-tone",
						mentioned && "ring-2 ring-orange-400/60",
					)}
				>
					{m.replyTo && (
						<div className="mb-2 border-l-2 border-current/30 pl-2 text-caption opacity-75">
							引用 {replied ? (actors.get(replied.senderId)?.name ?? "群成员") : "历史消息"}：
							{replied && "text" in replied.content ? replied.content.text.slice(0, 100) : "附件或未加载的消息"}
						</div>
					)}
					{mentioned && (
						<span className="mb-1 block text-caption font-medium text-orange-600">
							{(c.type === "text" || c.type === "markdown") && c.mentionAll ? "@所有人" : "有人@你"}
						</span>
					)}
					{(c.type === "text" || c.type === "markdown") &&
						c.mentions
							?.filter((id) => !c.text.includes(`@${actors.get(id)?.name ?? "群成员"}`))
							.map((id) => (
								<span key={id} className="mr-2 text-small font-medium">
									@{actors.get(id)?.name ?? "群成员"}
								</span>
							))}
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
										className="press inline-flex h-8 items-center rounded-full bg-accent px-3 text-small font-medium text-on-accent"
									>
										{a.label}
									</Link>
								))}
							</div>
						</div>
					)}
					{copied && (
						<span
							role="status"
							aria-label="已复制"
							className="feedback ml-1.5 inline-flex items-center align-[-0.125em] text-caption text-faint"
						>
							<Check size={12} className="pop" aria-hidden />
						</span>
					)}
				</div>
				<time
					dateTime={new Date(m.createdAt).toISOString()}
					className="px-1 text-caption leading-4 text-faint opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 transition-opacity"
				>
					{messageClock(m.createdAt)}
				</time>
				{menu && (
					<ActionMenu
						at={menu}
						title="消息"
						actions={[
							{ key: "reply", label: "引用", icon: Reply, onSelect: onReply },
							{ key: "copy", label: "复制", icon: Copy, onSelect: copy },
							...(onPin ? [{ key: "pin", label: pinned ? "取消置顶" : "置顶消息", icon: Pin, onSelect: onPin }] : []),
							...(onAnnounce ? [{ key: "announce", label: "设为群公告", icon: Bell, onSelect: onAnnounce }] : []),
						]}
						onClose={() => setMenu(null)}
					/>
				)}
			</div>
		</div>
	);
}

export function Composer({
	convId,
	mutedUntil,
	members = [],
	quoteText,
	onClearQuote,
	reply,
	onClearReply,
	offline,
	agentId,
	cloudBot,
	onSend,
}: {
	convId: string;
	mutedUntil?: number | null;
	members?: Actor[];
	quoteText?: string;
	onClearQuote?: () => void;
	reply?: Message;
	onClearReply?: () => void;
	offline: boolean;
	/** 对方是没有设备的云端 Bot（小歪）：只能引导，不是「离线」 */
	cloudBot?: boolean;
	/** 私聊对象是 Bot 时传入：发完后重新取它的在线状态，避免页面里缓存的「在线」过期而漏掉离线提示 */
	agentId?: string;
	onSend: () => void;
}) {
	const [text, setText] = useState("");
	const [mentionTokens, setMentionTokens] = useState<MentionToken[]>([]);
	const [caret, setCaret] = useState(0),
		[dismissed, setDismissed] = useState(false),
		[composition, setComposition] = useState(false),
		[choice, setChoice] = useState(0);
	const [now, setNow] = useState(Date.now());
	const muted = !!mutedUntil && mutedUntil > now;
	useEffect(() => {
		if (!muted) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [muted]);
	const query = !dismissed && !composition && members.length ? mentionQuery(text, caret) : null;
	const options = query
		? [{ id: "all", name: "所有人" }, ...members]
				.filter((m) => m.name.toLowerCase().includes(query.query.toLowerCase()))
				.slice(0, 32)
		: [];
	const chooseMention = (member: { id: string; name: string }) => {
		if (!query) return;
		if (
			member.id !== "all" &&
			!mentionTokens.some((t) => t.id === member.id) &&
			new Set(mentionTokens.flatMap((t) => (t.id ? [t.id] : []))).size >= 32
		) {
			toast("每条消息最多提及 32 位成员");
			return;
		}
		const label = `@${member.name}`,
			next = `${text.slice(0, query.start) + label} ${text.slice(query.end)}`;
		setMentionTokens([
			...editedMentions(text, next, mentionTokens),
			{
				start: query.start,
				end: query.start + label.length,
				label,
				...(member.id === "all" ? { all: true } : { id: member.id }),
			},
		]);
		setText(next);
		setCaret(query.start + label.length + 1);
		setDismissed(true);
		requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.setSelectionRange(query.start + label.length + 1, query.start + label.length + 1);
		});
	};
	const ref = useRef<HTMLTextAreaElement>(null);
	const loc = useLocation();
	const nav = useNavigate();
	const consumed = useRef<string | null>(null);
	// 市场页把整理好的上下文带来时只填充输入框，发送仍由用户确认。
	useEffect(() => {
		const draft = readMarketDraft(loc.state, convId);
		if (!draft || consumed.current === loc.key) return;
		consumed.current = loc.key;
		setText((previous) => (previous ? `${previous}\n\n${draft}` : draft));
		const { marketDraft: _draft, ...rest } = loc.state;
		nav(loc.pathname + loc.search, { replace: true, state: rest });
		toast("已带入市场内容，确认后再发送给 Bot");
	}, [loc.key, loc.state, convId, nav, loc.pathname, loc.search]);
	useEffect(() => {
		if (consumed.current && ref.current) {
			ref.current.style.height = "auto";
			ref.current.style.height = `${Math.min(ref.current.scrollHeight, 160)}px`;
		}
	}, []);
	const qc = useQueryClient();
	const [sending, setSending] = useState(false);
	const pending = useRef(false);
	const [verify, setVerify] = useState(false);
	const session = useStore($session);
	const guest = session?.guest;
	const send = async (body = text.trim()): Promise<boolean> => {
		if (!body || pending.current || muted) return false;
		pending.current = true;
		setSending(true);
		try {
			const content = {
				type: "markdown" as const,
				text: quoteText
					? `${quoteText
							.split("\n")
							.map((line) => `> ${line}`)
							.join("\n")}\n\n${body}`
					: body,
				...(body === text.trim() ? mentionMetadata(text, mentionTokens) : {}),
			};
			const message = reply ? await api.send(convId, content, reply.id) : await api.send(convId, content);
			qc.setQueryData<Message[]>(["msgs", convId], (old) =>
				old?.some((m) => m.id === message.id) ? old : [...(old ?? []), message].slice(-120),
			);
			void qc.invalidateQueries({ queryKey: ["convs"] });
			void qc.invalidateQueries({ queryKey: ["msgs", convId] });
			setText("");
			setMentionTokens([]);
			setDismissed(true);
			onClearReply?.();
			onClearQuote?.();
			const session = $session.get();
			if (session?.guest)
				$session.set({ ...session, guest: { ...session.guest, remaining: Math.max(0, session.guest.remaining - 1) } });
			if (ref.current) ref.current.style.height = "";
			onSend();
			if (agentId) {
				const [fresh] = await api.actors([agentId]).catch(() => [] as Actor[]);
				void qc.invalidateQueries({ queryKey: ["actors"] });
				if (fresh ? !fresh.online : offline) toast(OFFLINE_HINT);
			} else if (offline) toast(OFFLINE_HINT);
			return true;
		} catch (error) {
			if (needsVerify(error)) {
				// 存进 sessionStorage：刷新或跳到登录页再回来，登录后仍会补发。
				savePendingSend(convId, body);
				setVerify(true);
				return false;
			}
			if (error instanceof Error && error.message === "muted") {
				toast("你已被禁言，草稿已保留", true);
				void qc.invalidateQueries({ queryKey: ["conv-detail", convId] });
				void qc.invalidateQueries({ queryKey: ["convs"] });
			} else toast(error instanceof Error ? error.message : "发送失败，请重试", true);
			return false;
		} finally {
			pending.current = false;
			setSending(false);
		}
	};
	const resend = async (body: string) => {
		if (await send(body)) toast("已为你发送");
	};
	const verified = (next: Session) => {
		selectAccount(next.actor.id, qc);
		$session.set(next);
		const body = takePendingSend(convId);
		if (body) void resend(body);
	};
	// 登录后回到这个会话（刷新或从登录页返回）：补发之前没发出去的消息。
	const signedIn = !!session && !session.actor.anonymous;
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在登录态或会话变化时补发一次，resend 每次渲染都会重建
	useEffect(() => {
		if (!signedIn) return;
		const body = takePendingSend(convId);
		if (body) void resend(body);
	}, [signedIn, convId]);
	return (
		<div className="shrink-0 px-4 pb-safe">
			{(reply || quoteText) && (
				<div className="mx-auto mb-2 flex max-w-[720px] items-center gap-2 text-small text-muted">
					<span className="truncate">
						引用：{quoteText ?? (reply && "text" in reply.content ? reply.content.text : "附件")}
					</span>
					<button
						type="button"
						onClick={() => {
							onClearReply?.();
							onClearQuote?.();
						}}
						aria-label="取消引用"
					>
						取消
					</button>
				</div>
			)}
			{muted && (
				<p role="status" className="mx-auto mb-2 max-w-[720px] text-center text-caption text-muted">
					禁言至 {new Date(mutedUntil ?? 0).toLocaleString()}，草稿已保留
				</p>
			)}
			<SocialPresence open={!!query && options.length > 0} kind="popup">
				<div
					role="listbox"
					id="chat-mention-options"
					aria-label="选择要提及的成员"
					className="scroll-y mx-auto mb-2 max-h-48 max-w-[720px] rounded-control border border-hairline bg-raised p-1 shadow-float"
				>
					{options.map((m, i) => (
						<button
							type="button"
							role="option"
							aria-selected={i === Math.min(choice, options.length - 1)}
							id={`mention-option-${i}`}
							key={m.id}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => chooseMention(m)}
							className={cn(
								"press block min-h-10 w-full rounded-control px-3 text-left text-small",
								i === choice && "bg-tone",
							)}
						>
							@{m.name}
						</button>
					))}
				</div>
			</SocialPresence>
			{guest && guest.remaining > 0 && guest.remaining <= 3 && (
				<p className="mx-auto mb-2 text-center text-small text-muted">还可发 {guest.remaining} 条，登录后无限制</p>
			)}
			<div className="field mx-auto flex max-w-[720px] items-end gap-2 rounded-field bg-raised p-2 pl-4 shadow-float">
				<textarea
					ref={ref}
					aria-label="输入消息"
					onBlur={() => setDismissed(true)}
					aria-controls={query && options.length ? "chat-mention-options" : undefined}
					aria-activedescendant={
						query && options.length ? `mention-option-${Math.min(choice, options.length - 1)}` : undefined
					}
					onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
					onCompositionStart={() => setComposition(true)}
					onCompositionEnd={(e) => {
						setComposition(false);
						setCaret(e.currentTarget.selectionStart);
						setDismissed(false);
					}}
					value={text}
					readOnly={sending}
					rows={1}
					placeholder={cloudBot ? "小歪暂时只能帮你开始" : offline ? OFFLINE_HINT : "输入消息"}
					onChange={(e) => {
						setMentionTokens(editedMentions(text, e.target.value, mentionTokens));
						setText(e.target.value);
						setCaret(e.target.selectionStart);
						setDismissed(false);
						setChoice(0);
						e.target.style.height = "auto";
						e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
					}}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing || composition) return;
						if (query && options.length) {
							if (e.key === "Escape") {
								e.preventDefault();
								setDismissed(true);
								return;
							}
							if (e.key === "ArrowDown" || e.key === "ArrowUp") {
								e.preventDefault();
								setChoice((n) => (n + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
								return;
							}
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								chooseMention(options[Math.min(choice, options.length - 1)]);
								return;
							}
						}
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							void send();
						}
					}}
					className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-body outline-none placeholder:text-faint"
				/>
				<button
					type="button"
					onClick={() => void send()}
					disabled={!text.trim() || sending || muted}
					aria-label={sending ? "发送中" : "发送"}
					className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:bg-tone-2 disabled:text-faint"
				>
					{sending ? <span className="text-caption">发送中</span> : <ArrowUp size={18} strokeWidth={2.25} />}
				</button>
			</div>
			<VerifySheet
				open={verify}
				onOpenChange={(open) => {
					setVerify(open);
					// 关闭时清掉待发；登录成功会在同一同步流程里先取走，所以放到微任务里。
					if (!open) queueMicrotask(() => clearPendingSend(convId));
				}}
				shareToken={new URLSearchParams(location.search).get("share") ?? undefined}
				onSuccess={verified}
			/>
		</div>
	);
}
