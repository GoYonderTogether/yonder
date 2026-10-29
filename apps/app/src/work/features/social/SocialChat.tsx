import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { qk } from "../../api/keys";
import { httpApi, type Message, type Session } from "../../api/social";
import { href } from "../../shell/routes";
import { toast } from "../../ui/kit/Toast";
import { AiBadge } from "./chat/AiBadge";
import { ChatDetail } from "./chat/ChatDetail";
import { MessageBubble } from "./chat/MessageBubble";
import { SocialAvatar, Status } from "./IdentityAvatar";
import { needsVerify } from "./lib/session";
import { VerifySheet } from "./VerifySheet";

/** 分享链接里的配额 token；路由用 hash，query 仍留在 location.search 上。 */
function shareToken(): string | undefined {
	if (typeof location === "undefined") return undefined;
	return new URLSearchParams(location.search).get("share") ?? undefined;
}

export function SocialChat({ id }: { id: string }) {
	const qc = useQueryClient();
	const [text, setText] = useState("");
	const [detail, setDetail] = useState(false);
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState("");
	const [verify, setVerify] = useState(false);
	/** 额度用尽时把待发内容留住，登录后原样重发。 */
	const pending = useRef("");
	const end = useRef<HTMLDivElement>(null);
	const resolved = useQuery({
		queryKey: ["social", "resolve", "conversation", id],
		queryFn: () => httpApi.resolve("conversation", id),
	});
	const convId = resolved.data?.id;
	const conversation = useQuery({
		queryKey: ["social", "conversation", convId],
		queryFn: () => httpApi.conversationDetail(convId ?? ""),
		enabled: !!convId,
	});
	const messages = useQuery({
		queryKey: ["social", "messages", convId],
		queryFn: () => httpApi.messages(convId ?? ""),
		enabled: !!convId,
	});
	const session = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session });
	const lastSeq = messages.data?.at(-1)?.seq;
	useEffect(() => {
		if (convId && lastSeq !== undefined)
			void httpApi.markRead(convId, lastSeq).catch(() => toast("标记已读失败", true));
	}, [convId, lastSeq]);
	useEffect(() => {
		if (messages.data?.length) end.current?.scrollIntoView({ block: "end" });
	}, [messages.data?.length]);
	// TODO: API department: expose subscribe on httpApi for live message updates.
	const send = async (body = text.trim()) => {
		if (!convId || !body || sending) return;
		setSending(true);
		setSendError("");
		try {
			const message = await httpApi.send(convId, { type: "markdown", text: body });
			qc.setQueryData<Message[]>(["social", "messages", convId], (old) =>
				old?.some((m) => m.id === message.id) ? old : [...(old ?? []), message],
			);
			void qc.invalidateQueries({ queryKey: ["social", "conversations"] });
			setText("");
		} catch (error) {
			// 访客额度用尽：弹登录窗，不静默拦截；待发内容留到验证成功后重发。
			if (needsVerify(error)) {
				pending.current = body;
				setVerify(true);
				return;
			}
			setSendError(error instanceof Error ? error.message : "发送失败，请重试");
		} finally {
			setSending(false);
		}
	};
	const verified = (session: Session) => {
		qc.setQueryData(qk.socialSession, session);
		const body = pending.current;
		pending.current = "";
		if (body) void send(body);
	};
	if (resolved.isLoading || session.isLoading || (convId && (conversation.isLoading || messages.isLoading)))
		return (
			<p role="status" className="p-6 text-muted">
				正在加载会话…
			</p>
		);
	if (resolved.isError || session.isError || conversation.isError || messages.isError)
		return (
			<div role="alert" className="p-6 text-muted">
				会话加载失败。
				<button
					type="button"
					className="underline"
					onClick={() => {
						void resolved.refetch();
						void session.refetch();
						if (convId) {
							void conversation.refetch();
							void messages.refetch();
						}
					}}
				>
					重试
				</button>
			</div>
		);
	if (!convId || !conversation.data)
		return (
			<div className="p-6 text-muted">
				<p role="status">会话不存在或无法访问</p>
				<a href={href({ tab: "chats" })} className="underline">
					回到消息
				</a>
			</div>
		);
	const conv = conversation.data;
	const me = session.data?.actor;
	const other = conv.kind === "dm" ? conv.members.find((member) => member.id !== me?.id) : undefined;
	return (
		<div className="relative flex h-full min-h-0 flex-col bg-ground">
			{/* 与名片站 AppBar 同版式：h-14、返回按钮 -ml-2、标题 15px 半粗、Agent 用小「AI」标 + 状态点。 */}
			<header className="relative z-10 flex h-14 shrink-0 items-center gap-2 px-4">
				<a
					href={href({ tab: "chats" })}
					aria-label="返回消息"
					className="press -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-tone"
				>
					<ArrowLeft size={20} />
				</a>
				<h1 className="flex min-w-0 flex-1 items-center gap-2.5">
					{other && (
						<span className="hidden shrink-0 lg:inline-flex">
							<SocialAvatar actor={other} size={32} />
						</span>
					)}
					<span className="min-w-0 truncate text-[15px] font-semibold">{conv.title}</span>
					{other?.kind === "agent" && <AiBadge />}
					{other?.kind === "agent" && (
						<span className="flex shrink-0 items-center gap-1.5 text-caption font-normal text-muted">
							<Status online={!!other.online} />
							{other.online ? "在线" : "离线"}
						</span>
					)}
				</h1>
				{conv.kind !== "notice" && (
					<button
						type="button"
						aria-label="聊天详情"
						onClick={() => setDetail(true)}
						className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-tone"
					>
						<Ellipsis size={20} />
					</button>
				)}
			</header>
			<div className="scroll-y relative z-10 min-h-0 flex-1 overflow-y-auto px-4">
				<ol aria-label="消息" className="mx-auto flex max-w-[720px] flex-col gap-0.5 py-4">
					{messages.data?.map((message, i, all) => (
						<MessageBubble
							key={message.id}
							message={message}
							sender={conv.members.find((member) => member.id === message.senderId)}
							mine={message.senderId === me?.id}
							group={conv.kind === "group"}
							first={all[i - 1]?.senderId !== message.senderId}
							last={all[i + 1]?.senderId !== message.senderId}
						/>
					))}
					{messages.data?.length === 0 && <li className="py-6 text-center text-small text-faint">还没有消息</li>}
				</ol>
				<div ref={end} />
			</div>
			{conv.kind !== "notice" && (
				<div className="shrink-0 px-4 pb-safe">
					<div className="field mx-auto flex max-w-[720px] items-end gap-2 rounded-[20px] bg-raised p-2 pl-4 shadow-float">
						<textarea
							aria-label="输入消息"
							value={text}
							readOnly={sending}
							rows={1}
							placeholder={other?.kind === "agent" && !other.online ? "Agent 离线，消息会保留" : "输入消息"}
							onChange={(e) => {
								setText(e.target.value);
								e.target.style.height = "auto";
								e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
									e.preventDefault();
									void send();
								}
							}}
							className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-body outline-none placeholder:text-faint"
						/>
						<button
							type="button"
							aria-label={sending ? "发送中" : "发送"}
							disabled={!text.trim() || sending}
							onClick={() => void send()}
							className="press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent disabled:bg-tone-2 disabled:text-faint"
						>
							{sending ? <span className="text-[11px]">发送中</span> : <ArrowUp size={18} strokeWidth={2.25} />}
						</button>
					</div>
					{sendError && (
						<p role="alert" className="mx-auto max-w-[720px] text-danger">
							{sendError}
						</p>
					)}
				</div>
			)}
			{detail && <ChatDetail conversation={conv} meId={me?.id} onClose={() => setDetail(false)} />}
			<VerifySheet open={verify} onOpenChange={setVerify} shareToken={shareToken()} onSuccess={verified} />
		</div>
	);
}
