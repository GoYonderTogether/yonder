import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { type ReactNode, useState } from "react";
import { type ConversationDetail, httpApi } from "../../../api/social";
import { cn } from "../../../lib/cn";
import { href } from "../../../shell/routes";
import { SocialAvatar, Status } from "../IdentityAvatar";
import { rememberShareToken, shareLinkKey, shareLinkUrl } from "../lib/shareLinks";
import { ShareLinks } from "../ShareLinks";
import { AiBadge } from "./AiBadge";

/** 分组块：tone/50 底、16px 圆角、块间 8px。与名片站 chat/ChatDetail 的 Section 同参数。 */
function Section({ children, className }: { children: ReactNode; className?: string }) {
	return <section className={cn("mx-3 my-2 overflow-hidden rounded-card bg-tone/50", className)}>{children}</section>;
}

function Row({ children }: { children: ReactNode }) {
	return <div className="flex h-12 w-full items-center gap-3 px-4 text-small">{children}</div>;
}

export function ChatDetail({
	conversation,
	meId,
	onClose,
}: {
	conversation: ConversationDetail;
	meId?: string;
	onClose: () => void;
}) {
	const qc = useQueryClient();
	const [error, setError] = useState("");
	const invite = useQuery({
		queryKey: ["social", "invite", conversation.id],
		queryFn: () => httpApi.groupInvite(conversation.id),
		enabled: conversation.kind === "group",
	});
	const members = conversation.kind === "dm" ? conversation.members.filter((m) => m.id !== meId) : conversation.members;
	const other = conversation.kind === "dm" ? members[0] : undefined;
	// 群二维码改用服务端分享链接：访客凭 ?share= 登录时按链接计配额。非成员/访客生成失败时退回群邀请地址。
	const share = useQuery({
		queryKey: ["social", "share-link", conversation.id],
		queryFn: async () => {
			const created = await httpApi.createShareLink({ kind: "group", targetId: conversation.id });
			rememberShareToken(shareLinkKey("group", conversation.id), created.token);
			return created;
		},
		enabled: conversation.kind === "group" && !!invite.data,
		retry: false,
	});
	const inviteHash = invite.data ? href({ tab: "chats", page: "g", session: invite.data.token }) : "";
	const inviteUrl = `${location.origin}${location.pathname}`;
	const qrValue = share.data
		? shareLinkUrl(share.data, inviteHash, inviteUrl)
		: invite.data
			? `${inviteUrl}${inviteHash}`
			: "";
	const leave = async () => {
		try {
			await httpApi.leaveConversation(conversation.id);
			void qc.invalidateQueries({ queryKey: ["social", "conversations"] });
			location.hash = href({ tab: "chats" });
		} catch (e) {
			setError(e instanceof Error ? e.message : "退出失败");
		}
	};
	const body =
		conversation.kind === "group" ? (
			<>
				<Section className="p-4">
					<p className="pb-3 text-[13px] text-muted">群成员 {conversation.members.length}</p>
					<ul className="grid grid-cols-4 gap-y-4">
						{conversation.members.map((member) => (
							<li key={member.id} className="min-w-0">
								<a
									href={href({ tab: "contacts", page: "contacts", session: member.code ?? member.id })}
									className="press flex flex-col items-center gap-1.5 px-1"
								>
									<SocialAvatar actor={member} size={44} />
									<span className="flex w-full items-center justify-center gap-1">
										<span className="truncate text-caption">{member.name}</span>
										{member.kind === "agent" && <AiBadge />}
									</span>
								</a>
							</li>
						))}
					</ul>
				</Section>
				<Section>
					<Row>
						<span className="text-muted">群名称</span>
						<span className="ml-auto truncate">{conversation.title}</span>
					</Row>
				</Section>
				<Section className="flex flex-col items-center gap-3 p-5">
					{qrValue ? (
						<div className="rounded-control bg-white p-3">
							<QRCodeSVG value={qrValue} size={140} />
						</div>
					) : (
						<div className="skeleton h-[164px] w-[164px] rounded-control" />
					)}
					{invite.isError && <p role="alert">群二维码加载失败</p>}
					<p className="text-caption text-muted">群二维码</p>
					<ShareLinks kind="group" targetId={conversation.id} label={conversation.title} hash={inviteHash} />
				</Section>
				<div className="px-3 py-4">
					<button
						type="button"
						onClick={() => void leave()}
						className="press flex h-11 w-full items-center justify-center rounded-full bg-tone text-small font-medium text-danger hover:bg-tone-2"
					>
						退出群聊
					</button>
				</div>
			</>
		) : (
			<>
				{other && (
					<Section>
						<a
							href={href({ tab: "contacts", page: "contacts", session: other.code ?? other.id })}
							className="press flex items-center gap-3 p-4 hover:bg-tone/60"
						>
							<SocialAvatar actor={other} size={48} online={other.kind === "agent" ? !!other.online : undefined} />
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-1.5">
									<span className="truncate text-body font-medium">{other.name}</span>
									{other.kind === "agent" && <AiBadge />}
								</span>
								{other.note && <span className="block truncate text-[13px] text-muted">{other.note}</span>}
							</span>
							<ChevronRight size={16} className="text-faint" />
						</a>
					</Section>
				)}
				{other && (
					<Section className="flex flex-col items-center gap-3 p-5">
						<div className="rounded-control bg-white p-3">
							<QRCodeSVG
								value={`${location.origin}${location.pathname}${href({
									tab: "chats",
									page: "p",
									session: other.code ?? other.id,
								})}`}
								size={140}
							/>
						</div>
						<p className="text-caption text-muted">{other.name} 的二维码</p>
					</Section>
				)}
				{other?.kind === "agent" && (
					<Section>
						<Row>
							<span className="text-muted">在线状态</span>
							<span className="ml-auto flex items-center gap-2">
								<Status online={!!other.online} className="h-1.5 w-1.5" />
								{other.online ? "在线" : "离线"}
							</span>
						</Row>
					</Section>
				)}
			</>
		);
	return (
		<aside
			aria-label="聊天详情"
			className="rise absolute inset-0 z-20 flex flex-col bg-raised lg:inset-y-0 lg:right-0 lg:left-auto lg:w-80 lg:shadow-float"
		>
			<header className="flex h-14 shrink-0 items-center justify-between pr-2 pl-5">
				<h2 className="text-[15px] font-semibold">聊天详情</h2>
				<button
					type="button"
					aria-label="关闭聊天详情"
					onClick={onClose}
					className="press flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-tone"
				>
					<X size={18} />
				</button>
			</header>
			<div className="scroll-y flex-1 overflow-y-auto pb-safe">
				{body}
				{error && (
					<p role="alert" className="px-4 pb-4 text-small text-danger">
						{error}
					</p>
				)}
			</div>
			<a
				href={href({ tab: "chats" })}
				aria-label="返回消息"
				className="press flex h-11 shrink-0 items-center justify-center gap-1 text-small text-muted hover:bg-tone"
			>
				<ArrowLeft size={16} />
				返回消息
			</a>
		</aside>
	);
}
