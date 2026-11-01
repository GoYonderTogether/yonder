import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../../api";
import { chatError } from "../../api/chat";
import type { ConversationDetail, Message } from "../../api/types";
import { appPath } from "../../lib/base";
import { cn } from "../../lib/cn";
import { entityRef } from "../../lib/entityRef";
import { internalState } from "../../lib/navigation";
import { useDesktop } from "../../lib/useDesktop";
import { $session } from "../../store";
import { Avatar, Status } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { togglePin, usePrefs } from "../../work/lib/prefs";
import { AppBar } from "../AppBar";
import { AiBadge } from "./AiBadge";
import { ChatBackgroundSettings } from "./ChatBackgroundSettings";
import { ChatHistory } from "./ChatHistory";
import { type GroupPanel, GroupSettings } from "./GroupSettings";

type ChatDetailProps = { convId: string; onClose: () => void; onSelectMessage?: (message: Message) => void };
/** 每个账号和会话都有独立的详情草稿与操作状态。 */
export function ChatDetail(props: ChatDetailProps) {
	const accountId = useStore($session)?.actor.id;
	return <ChatDetailContent key={JSON.stringify([accountId, props.convId])} {...props} />;
}
/** 聊天详情与记录复用一个容器：手机整页，桌面右侧面板。 */
function ChatDetailContent({
	convId,
	onClose,
	onSelectMessage,
}: {
	convId: string;
	onClose: () => void;
	onSelectMessage?: (message: Message) => void;
}) {
	const desktop = useDesktop(),
		qc = useQueryClient();
	const accountId = useStore($session)?.actor.id;
	const [screen, setScreen] = useState<"detail" | "history" | "background">("detail");
	const [groupPanel, setGroupPanel] = useState<GroupPanel>("home");
	const [busy, setBusy] = useState(false);
	const [historyMessage, setHistoryMessage] = useState<Message | null>(null);
	useEffect(() => {
		const refresh = () => void qc.invalidateQueries({ queryKey: ["conv-detail", convId] });
		window.addEventListener("yonder:presence", refresh);
		return () => window.removeEventListener("yonder:presence", refresh);
	}, [qc, convId]);
	const query = useQuery({
		queryKey: ["conv-detail", convId],
		queryFn: () => api.conversationDetail(convId),
		retry: false,
	});
	const detail = query.data;
	const common = (
		<CommonDetails
			convId={convId}
			disabled={busy}
			onBackground={() => {
				setGroupPanel("home");
				setScreen("background");
			}}
			onSearch={() => {
				setGroupPanel("home");
				setHistoryMessage(null);
				setScreen("history");
			}}
		/>
	);
	const body = query.isPending ? (
		<div className="skeleton m-4 h-40 rounded-card" />
	) : !detail ? (
		<div className="flex flex-col gap-3 p-4">
			<p role="alert" className="text-small text-danger">
				{chatError(query.error, "无法读取聊天详情")}
			</p>
			<Button onClick={() => void query.refetch()}>重试</Button>
		</div>
	) : screen === "background" ? (
		<ChatBackgroundSettings
			accountId={accountId}
			convId={convId}
			busy={busy}
			onBusyChange={setBusy}
			onApplied={onClose}
		/>
	) : screen !== "detail" ? (
		<ChatHistory
			key={screen}
			d={detail}
			preview={historyMessage}
			onPreviewChange={setHistoryMessage}
			onSelectMessage={
				onSelectMessage
					? (message) => {
							onSelectMessage(message);
							onClose();
						}
					: undefined
			}
		/>
	) : detail.kind === "group" ? (
		<GroupSettings
			key={detail.id}
			d={detail}
			panel={groupPanel}
			onPanelChange={setGroupPanel}
			busy={busy}
			onBusyChange={setBusy}
		>
			{common}
		</GroupSettings>
	) : (
		<>
			<DmDetail d={detail} />
			{common}
		</>
	);
	const groupSubpage = detail?.kind === "group" && groupPanel !== "home";
	const titles: Record<GroupPanel, string> = {
		home: "聊天详情",
		nickname: "我在本群的昵称",
		identity: "群名称",
		members: "群成员",
		member: "成员设置",
		transfer: "移交群主",
		invite: "邀请入群",
		leave: "退出群聊",
		dissolve: "解散群聊",
	};
	const title =
		screen === "background"
			? "聊天背景"
			: screen === "history"
				? historyMessage
					? historyMessage.content.type === "image"
						? "图片预览"
						: "消息预览"
					: "聊天记录"
				: detail?.kind === "group"
					? titles[groupPanel]
					: "聊天详情";
	const back = () => {
		if (busy) return;
		if (screen === "background") {
			setScreen("detail");
			setGroupPanel("home");
		} else if (screen === "history" && historyMessage) {
			setHistoryMessage(null);
		} else if (screen === "history") {
			setScreen("detail");
			setGroupPanel("home");
		} else if (groupSubpage) {
			setGroupPanel(groupPanel === "transfer" ? "member" : groupPanel === "member" ? "members" : "home");
		} else onClose();
	};
	const backButton = (
		<button
			type="button"
			className="press -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-tone"
			onClick={back}
			disabled={busy}
			aria-label={screen === "detail" ? "返回" : historyMessage ? "返回查询结果" : "返回聊天详情"}
		>
			<ArrowLeft size={20} />
		</button>
	);
	if (desktop)
		return (
			<aside
				aria-label={title}
				className="absolute inset-y-0 right-0 z-20 flex w-96 max-w-full flex-col bg-raised shadow-float"
			>
				<header className="flex h-14 shrink-0 items-center gap-2 pr-2 pl-4">
					{(screen !== "detail" || groupSubpage) && backButton}
					<h2 className="flex-1 text-body font-semibold">{title}</h2>
					<button
						type="button"
						aria-label="关闭"
						onClick={onClose}
						disabled={busy}
						className="press flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-tone"
					>
						<X size={18} />
					</button>
				</header>
				<div className="scroll-y flex-1">{body}</div>
			</aside>
		);
	return (
		<div className="fixed inset-0 z-30 flex flex-col bg-ground">
			<AppBar left={backButton} title={title} />
			<div className="scroll-y flex-1 pb-safe">{body}</div>
		</div>
	);
}
function CommonDetails({
	convId,
	onSearch,
	onBackground,
	disabled,
}: {
	convId: string;
	onSearch: () => void;
	onBackground: () => void;
	disabled: boolean;
}) {
	const pinned = usePrefs().pinned.includes(convId);
	return (
		<Section>
			<Row disabled={disabled} onClick={onSearch}>
				查找聊天记录
				<ChevronRight size={16} className="ml-auto text-faint" />
			</Row>
			<Row disabled={disabled} onClick={onBackground}>
				聊天背景
				<ChevronRight size={16} className="ml-auto text-faint" />
			</Row>
			<button
				type="button"
				role="switch"
				disabled={disabled}
				aria-checked={pinned}
				onClick={() => togglePin(convId)}
				className="press flex h-12 w-full items-center justify-between px-4 text-body hover:bg-tone/60"
			>
				<span>置顶聊天</span>
				<span
					aria-hidden
					className={`flex h-6 w-10 items-center rounded-full p-0.5 ${pinned ? "bg-accent justify-end" : "bg-tone-2"}`}
				>
					<span className="h-5 w-5 rounded-full bg-white shadow-sm" />
				</span>
			</button>
		</Section>
	);
}

const Row = ({
	to,
	onClick,
	children,
	disabled,
}: {
	to?: string;
	onClick?: () => void;
	children: React.ReactNode;
	disabled?: boolean;
}) => {
	const loc = useLocation();
	const cls = "press flex h-12 w-full items-center gap-3 px-4 text-body hover:bg-tone/60";
	return to ? (
		<Link to={to} state={internalState(loc)} className={cls}>
			{children}
		</Link>
	) : (
		<button type="button" disabled={disabled} onClick={onClick} className={cls}>
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
							<span className="truncate text-body font-medium">{other.name}</span>
							{other.kind === "agent" && <AiBadge />}
						</span>
						{other.note && <span className="block truncate text-small text-muted">{other.note}</span>}
					</span>
					<ChevronRight size={16} className="text-faint" />
				</Link>
			</Section>
			{other.kind === "agent" && (device || owner) && (
				<Section>
					{device && (
						<div className="flex h-12 items-center gap-3 px-4 text-small">
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
				<p className="text-caption text-muted">{other.name} 的二维码</p>
			</Section>
		</>
	);
}
