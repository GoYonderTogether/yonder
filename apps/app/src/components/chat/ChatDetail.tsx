import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Plus, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../api";
import type { ConversationDetail } from "../../api/types";
import { appPath } from "../../lib/base";
import { cn } from "../../lib/cn";
import { entityRef } from "../../lib/entityRef";
import { internalState } from "../../lib/navigation";
import { useDesktop } from "../../lib/useDesktop";
import { useShareUrl } from "../../lib/useShareUrl";
import { $session } from "../../store";
import { Avatar, Status } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { toast } from "../../ui/Toast";
import { AppBar } from "../AppBar";
import { ShareLinks } from "../ShareLinks";
import { AiBadge } from "./AiBadge";

/** 聊天详情：手机是推入的整页，桌面是主区右侧抽屉。 */
export function ChatDetail({ convId, onClose }: { convId: string; onClose: () => void }) {
	const desktop = useDesktop();
	const qc = useQueryClient();
	useEffect(() => {
		const refresh = () => {
			void qc.invalidateQueries({ queryKey: ["conv-detail", convId] });
		};
		window.addEventListener("yonder:presence", refresh);
		return () => window.removeEventListener("yonder:presence", refresh);
	}, [qc, convId]);
	const { data: detail } = useQuery({
		queryKey: ["conv-detail", convId],
		queryFn: () => api.conversationDetail(convId),
	});
	const body = !detail ? (
		<div className="skeleton m-4 h-40 rounded-card" />
	) : detail.kind === "group" ? (
		<GroupDetail key={detail.id} d={detail} onClose={onClose} />
	) : (
		<DmDetail d={detail} />
	);
	if (desktop) {
		return (
			<aside
				aria-label="聊天详情"
				className="rise absolute inset-y-0 right-0 z-20 flex w-80 flex-col bg-raised shadow-float"
			>
				<header className="flex h-14 shrink-0 items-center justify-between pr-2 pl-5">
					<h2 className="text-[15px] font-semibold">聊天详情</h2>
					<button
						type="button"
						aria-label="关闭"
						onClick={onClose}
						className="press flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-tone"
					>
						<X size={18} />
					</button>
				</header>
				<div className="scroll-y flex-1">{body}</div>
			</aside>
		);
	}
	return (
		<div className="rise fixed inset-0 z-30 flex flex-col bg-ground">
			<AppBar
				left={
					<button
						type="button"
						className="press -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-tone"
						onClick={onClose}
						aria-label="返回"
					>
						<ArrowLeft size={20} />
					</button>
				}
				title="聊天详情"
			/>
			<div className="scroll-y flex-1 pb-safe">{body}</div>
		</div>
	);
}

const Row = ({ to, onClick, children }: { to?: string; onClick?: () => void; children: React.ReactNode }) => {
	const loc = useLocation();
	const cls = "press flex h-12 w-full items-center gap-3 px-4 text-[15px] hover:bg-tone/60";
	return to ? (
		<Link to={to} state={internalState(loc)} className={cls}>
			{children}
		</Link>
	) : (
		<button type="button" onClick={onClick} className={cls}>
			{children}
		</button>
	);
};

function Section({ children, className }: { children: React.ReactNode; className?: string }) {
	return <section className={cn("mx-3 my-2 overflow-hidden rounded-card bg-tone/50", className)}>{children}</section>;
}

function DmDetail({ d }: { d: ConversationDetail }) {
	const loc = useLocation();
	const me = useStore($session)?.actor;
	const other = d.members.find((m) => m.id !== me?.id);
	const { data: devices = [] } = useQuery({
		queryKey: ["devices"],
		queryFn: api.devices,
		enabled: other?.kind === "agent",
	});
	const { data: owners = [] } = useQuery({
		queryKey: ["actors", other?.ownerId],
		queryFn: () => api.actors(other?.ownerId ? [other.ownerId] : []),
		enabled: !!other?.ownerId,
	});
	if (!other) return null;
	const device = devices.find((x) => x.id === other.deviceId);
	const owner = owners[0];
	const profile = `${location.origin}${appPath(`/p/${entityRef(other)}`)}`;
	return (
		<>
			<Section>
				<Link
					to={`/contacts/${entityRef(other)}`}
					state={internalState(loc)}
					className="press flex items-center gap-3 p-4 hover:bg-tone/60"
				>
					<Avatar actor={other} size={48} online={other.kind === "agent" ? other.online : undefined} />
					<span className="min-w-0 flex-1">
						<span className="flex items-center gap-1.5">
							<span className="truncate text-[15px] font-medium">{other.name}</span>
							{other.kind === "agent" && <AiBadge />}
						</span>
						{other.note && <span className="block truncate text-[13px] text-muted">{other.note}</span>}
					</span>
					<ChevronRight size={16} className="text-faint" />
				</Link>
			</Section>
			{other.kind === "agent" && (device || owner) && (
				<Section>
					{device && (
						<div className="flex h-12 items-center gap-3 px-4 text-[14px]">
							<span className="text-muted">所在设备</span>
							<span className="ml-auto flex items-center gap-2">
								<Status online={!!other.online} className="h-1.5 w-1.5" />
								{device.name} · {other.online ? "在线" : "离线"}
							</span>
						</div>
					)}
					{owner && (
						<Row to={`/contacts/${entityRef(owner)}`}>
							<span className="text-muted">主人</span>
							<span className="ml-auto">{owner.name}</span>
						</Row>
					)}
				</Section>
			)}
			<Section>
				<Row to={`/contacts/${entityRef(other)}`}>
					查看名片
					<ChevronRight size={16} className="ml-auto text-faint" />
				</Row>
			</Section>
			<Section className="flex flex-col items-center gap-3 p-5">
				<div className="rounded-control bg-white p-3">
					<QRCodeSVG value={profile} size={140} />
				</div>
				<p className="text-[12px] text-muted">{other.name} 的二维码</p>
			</Section>
		</>
	);
}

function GroupDetail({ d }: { d: ConversationDetail; onClose: () => void }) {
	const nav = useNavigate();
	const loc = useLocation();
	const qc = useQueryClient();
	const me = useStore($session)?.actor;
	const myRole = d.members.find((m) => m.id === me?.id)?.role;
	const owner = myRole === "owner" && !me?.anonymous;
	const manage = (owner || myRole === "admin") && !me?.anonymous;
	const [title, setTitle] = useState(d.title);
	const savedTitle = useRef(d.title);
	useEffect(() => {
		setTitle((current) => (current === savedTitle.current ? d.title : current));
		savedTitle.current = d.title;
	}, [d.title]);
	const [busy, setBusy] = useState(false);
	const save = async (action: () => Promise<void>) => {
		setBusy(true);
		try {
			await action();
			await Promise.all(["conv-detail", "convs"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
		} catch (error) {
			toast(error instanceof Error ? error.message : "保存失败", true);
		} finally {
			setBusy(false);
		}
	};
	const { data: invite } = useQuery({ queryKey: ["invite", d.id], queryFn: () => api.groupInvite(d.id) });
	const invitePath = invite ? `/g/${invite.token}` : "";
	const qrValue = useShareUrl(
		{ kind: "group", targetId: d.id, path: invitePath },
		`${location.origin}${appPath(invitePath)}`,
		!!invite,
	);
	const leave = async () => {
		try {
			await api.leaveConversation(d.id);
			void qc.invalidateQueries({ queryKey: ["convs"] });
			nav("/", { replace: true });
		} catch (error) {
			toast(error instanceof Error ? error.message : "退出失败", true);
		}
	};
	return (
		<>
			<Section className="p-4">
				<p className="pb-3 text-[13px] text-muted">群成员 {d.members.length}</p>
				<ul className="grid grid-cols-4 gap-y-4">
					{d.members.map((m) => (
						<li key={m.id} className="min-w-0">
							<Link
								to={`/contacts/${entityRef(m)}`}
								state={internalState(loc)}
								className="press flex flex-col items-center gap-1.5 px-1"
							>
								<Avatar actor={m} size={44} />
								<span className="flex w-full items-center justify-center gap-1">
									<span className="truncate text-[12px]">{m.name}</span>
									{m.kind === "agent" && <AiBadge />}
								</span>
								{m.role && m.role !== "member" && (
									<span className="text-[11px] text-muted">{m.role === "owner" ? "群主" : "管理员"}</span>
								)}
							</Link>
						</li>
					))}
					<li className="flex flex-col items-center gap-1.5 px-1">
						<button
							type="button"
							aria-label="添加成员"
							onClick={() => toast("即将推出")}
							className="press flex h-11 w-11 items-center justify-center rounded-full bg-tone-2 text-muted hover:text-ink"
						>
							<Plus size={20} />
						</button>
					</li>
				</ul>
			</Section>
			<Section>
				{manage ? (
					<form
						className="flex flex-col gap-2 p-4"
						onSubmit={(event) => {
							event.preventDefault();
							void save(() => api.renameGroup(d.id, title));
						}}
					>
						<label htmlFor="group-title" className="text-[13px] text-muted">
							群名称
						</label>
						<input
							id="group-title"
							value={title}
							maxLength={100}
							required
							disabled={busy}
							onChange={(event) => setTitle(event.target.value)}
							className="h-10 min-w-0 rounded-control bg-ground px-3 text-[14px]"
						/>
						<Button type="submit" disabled={busy || !title.trim() || title.trim() === d.title}>
							保存群名称
						</Button>
					</form>
				) : (
					<div className="flex min-h-12 items-center gap-3 px-4 text-[14px]">
						<span className="text-muted">群名称</span>
						<span className="ml-auto truncate">{d.title}</span>
					</div>
				)}
			</Section>
			{owner && (
				<Section className="p-4">
					<p className="mb-3 text-[13px] text-muted">群管理</p>
					{d.members
						.filter((m) => m.kind === "human" && !m.anonymous && m.id !== me?.id)
						.map((m) => (
							<div key={m.id} className="flex flex-col gap-2 border-t border-line py-3 first:border-0">
								<span className="text-[14px]">{m.name}</span>
								<div className="flex flex-wrap gap-2">
									<Button
										disabled={busy}
										onClick={() =>
											void save(() => api.setGroupRole(d.id, m.id, m.role === "admin" ? "member" : "admin"))
										}
									>
										{m.role === "admin" ? "取消管理员" : "设为管理员"}
									</Button>
									<Button
										disabled={busy}
										onClick={() => {
											if (window.confirm(`将群主移交给${m.name}？移交后你将成为普通成员。`))
												void save(() => api.setGroupRole(d.id, m.id, "owner"));
										}}
									>
										移交群主
									</Button>
								</div>
							</div>
						))}
				</Section>
			)}
			<Section className="flex flex-col items-center gap-3 p-5">
				{invite ? (
					<div className="rounded-control bg-white p-3">
						<QRCodeSVG value={qrValue} size={140} />
					</div>
				) : (
					<div className="skeleton h-[164px] w-[164px] rounded-control" />
				)}
				<p className="text-[12px] text-muted">群二维码</p>
				{invite && <ShareLinks kind="group" targetId={d.id} label={d.title} path={invitePath} />}
			</Section>
			<div className="px-3 py-4">
				<Button className="h-11 w-full text-danger" onClick={leave}>
					退出群聊
				</Button>
			</div>
		</>
	);
}
