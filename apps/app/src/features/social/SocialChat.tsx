import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { qk } from "../../api/keys";
import { httpApi, type Message } from "../../api/social";
import { href } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { toast } from "../../ui/kit/Toast";
import { ChatDetail } from "./chat/ChatDetail";
import { MessageBubble } from "./chat/MessageBubble";

export function SocialChat({ id }: { id: string }) {
	const qc = useQueryClient();
	const [text, setText] = useState("");
	const [detail, setDetail] = useState(false);
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState("");
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
	const send = async () => {
		const body = text.trim();
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
			setSendError(error instanceof Error ? error.message : "发送失败，请重试");
		} finally {
			setSending(false);
		}
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
			<header className="flex h-14 shrink-0 items-center gap-2 px-3">
				<a
					href={href({ tab: "chats" })}
					aria-label="返回消息"
					className="press flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-tone"
				>
					<ArrowLeft size={20} />
				</a>
				<h1 className="min-w-0 flex-1 truncate text-[16px] font-semibold">
					{conv.title}
					{other?.kind === "agent" && (
						<span className="ml-2 rounded-[6px] bg-tone-2 px-1 text-[12px] text-muted">
							AI · {other.online ? "在线" : "离线"}
						</span>
					)}
				</h1>
				{conv.kind !== "notice" && (
					<Button variant="ghost" size="icon" aria-label="聊天详情" onClick={() => setDetail(true)}>
						<Ellipsis size={20} />
					</Button>
				)}
			</header>
			<div className="scroll-y min-h-0 flex-1 overflow-y-auto px-4">
				<ol aria-label="消息" className="mx-auto flex max-w-[720px] flex-col gap-0.5 py-4">
					{messages.data?.map((message, i, all) => (
						<MessageBubble
							key={message.id}
							message={message}
							sender={conv.members.find((member) => member.id === message.senderId)}
							mine={message.senderId === me?.id}
							group={conv.kind === "group"}
							first={all[i - 1]?.senderId !== message.senderId}
						/>
					))}
					{messages.data?.length === 0 && <li className="py-6 text-center text-[14px] text-faint">还没有消息</li>}
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
							className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-faint"
						/>
						<Button
							variant="primary"
							size="icon"
							aria-label={sending ? "发送中" : "发送"}
							disabled={!text.trim() || sending}
							onClick={() => void send()}
						>
							<ArrowUp size={18} />
						</Button>
					</div>
					{sendError && (
						<p role="alert" className="mx-auto max-w-[720px] text-danger">
							{sendError}
						</p>
					)}
				</div>
			)}
			{detail && <ChatDetail conversation={conv} meId={me?.id} onClose={() => setDetail(false)} />}
		</div>
	);
}
