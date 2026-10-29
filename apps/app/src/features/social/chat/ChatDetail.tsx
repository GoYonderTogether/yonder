import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { type ConversationDetail, httpApi } from "../../../api/social";
import { href } from "../../../shell/routes";
import { ActorAvatar } from "../../../ui/kit/ActorAvatar";
import { Button } from "../../../ui/kit/Button";
import { rememberShareToken, shareLinkKey, shareLinkUrl } from "../lib/shareLinks";
import { ShareLinks } from "../ShareLinks";

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
	return (
		<aside
			aria-label="聊天详情"
			className="absolute inset-0 z-20 flex flex-col bg-raised lg:inset-y-0 lg:right-0 lg:left-auto lg:w-80 lg:shadow-float"
		>
			<header className="flex h-14 shrink-0 items-center justify-between px-4">
				<h2 className="font-semibold">聊天详情</h2>
				<Button variant="ghost" size="icon" aria-label="关闭聊天详情" onClick={onClose}>
					<X size={18} />
				</Button>
			</header>
			<div className="scroll-y flex-1 overflow-y-auto p-3">
				<section className="rounded-card bg-tone/50 p-4">
					<p className="pb-3 text-[13px] text-muted">
						{conversation.kind === "group" ? `群成员 ${members.length}` : "联系人"}
					</p>
					<ul className="grid grid-cols-4 gap-3">
						{members.map((member) => (
							<li key={member.id}>
								<a
									href={href({ tab: "contacts", page: "contacts", session: member.code ?? member.id })}
									className="flex flex-col items-center gap-1"
								>
									<ActorAvatar seed={member.id} group={member.kind === "agent" ? "bot" : "import"} size={44} />
									<span className="max-w-full truncate text-[12px]">
										{member.name}
										{member.kind === "agent" && " · AI"}
									</span>
								</a>
							</li>
						))}
					</ul>
				</section>
				{conversation.kind === "dm" && members[0] && (
					<div className="my-3 flex flex-col items-center gap-3 rounded-card bg-tone/50 p-5">
						<div className="rounded-control bg-white p-3">
							<QRCodeSVG
								value={`${location.origin}${href({ tab: "chats", page: "p", session: members[0].code ?? members[0].id })}`}
								size={140}
							/>
						</div>
						<p className="text-[12px] text-muted">{members[0].name} 的二维码</p>
					</div>
				)}
				{conversation.kind === "group" && (
					<>
						<p className="my-3 rounded-card bg-tone/50 p-4">
							群名称 <span className="float-right">{conversation.title}</span>
						</p>
						<div className="flex flex-col items-center gap-3 rounded-card bg-tone/50 p-5">
							{qrValue && (
								<div className="rounded-control bg-white p-3">
									<QRCodeSVG value={qrValue} size={140} />
								</div>
							)}
							{invite.isError && <p role="alert">群二维码加载失败</p>}
							<p className="text-[12px] text-muted">群二维码</p>
							<ShareLinks kind="group" targetId={conversation.id} label={conversation.title} hash={inviteHash} />
						</div>
						<Button className="mt-4 w-full text-danger" onClick={() => void leave()}>
							退出群聊
						</Button>
					</>
				)}
				{error && <p role="alert">{error}</p>}
			</div>
		</aside>
	);
}
