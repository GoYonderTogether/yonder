import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ChevronRight } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../api";
import { chatApi, chatError, MUTE_DURATIONS, type MuteSeconds, uploadGroupAvatar } from "../../api/chat";
import type { ConversationDetail } from "../../api/types";
import { appPath } from "../../lib/base";
import { entityRef } from "../../lib/entityRef";
import { groupMemberName, validateGroupNickname } from "../../lib/groupMemberName";
import { internalState } from "../../lib/navigation";
import { useShareUrl } from "../../lib/useShareUrl";
import { $session } from "../../store";
import { Avatar, GroupAvatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { ShareLinks } from "../ShareLinks";
import { canAssignRole, canMuteMember, groupPermissions } from "./groupPermissions";

const box = "mx-3 my-2 overflow-hidden rounded-card bg-tone/50";
const row = "press flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-small hover:bg-tone/60";
function Invite({ d }: { d: ConversationDetail }) {
	const query = useQuery({ queryKey: ["invite", d.id], queryFn: () => api.groupInvite(d.id), retry: false });
	const path = query.data ? `/g/${query.data.token}` : "";
	const url = useShareUrl({ kind: "group", targetId: d.id, path }, location.origin + appPath(path), !!query.data);
	return (
		<section className={`${box} flex flex-col items-center gap-4 p-5`}>
			<h3 className="text-body font-medium">邀请入群</h3>
			{query.isPending ? (
				<p role="status" className="text-small text-muted">
					正在获取邀请…
				</p>
			) : query.error ? (
				<>
					<p role="alert" className="text-small text-danger">
						{chatError(query.error, "无法获取入群邀请")}
					</p>
					<Button onClick={() => void query.refetch()}>重试</Button>
				</>
			) : query.data ? (
				<>
					<div className="rounded-control bg-white p-3">
						<QRCodeSVG value={url} size={164} />
					</div>
					<p className="text-caption text-muted">扫码查看群聊并加入</p>
					<ShareLinks kind="group" targetId={d.id} label={d.title} path={path} />
				</>
			) : null}
		</section>
	);
}
export type GroupPanel =
	| "nickname"
	| "home"
	| "identity"
	| "members"
	| "member"
	| "transfer"
	| "invite"
	| "leave"
	| "dissolve";
export function GroupSettings({
	d,
	children,
	panel,
	onPanelChange,
	busy,
	onBusyChange,
}: {
	d: ConversationDetail;
	children?: ReactNode;
	panel: GroupPanel;
	onPanelChange: (panel: GroupPanel) => void;
	busy: boolean;
	onBusyChange: (busy: boolean) => void;
}) {
	const me = useStore($session)?.actor,
		permissions = groupPermissions(d, me),
		qc = useQueryClient(),
		nav = useNavigate(),
		loc = useLocation();
	const [memberId, setMemberId] = useState<string>();
	const member = d.members.find((m) => m.id === memberId);
	const currentNickname = d.selfNickname ?? d.members.find((m) => m.id === me?.id)?.nickname ?? "";
	const [nickname, setNickname] = useState(currentNickname);
	const [title, setTitle] = useState(d.title),
		[error, setError] = useState(""),
		[progress, setProgress] = useState<number | null>(null),
		[duration, setDuration] = useState<MuteSeconds>(600);
	const input = useRef<HTMLInputElement>(null);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const go = (next: typeof panel) => {
		setError("");
		onPanelChange(next);
	};
	async function perform(action: () => Promise<unknown>, after?: () => void) {
		if (busy) return;
		onBusyChange(true);
		setError("");
		try {
			await action();
			if (!alive.current) return;
			await Promise.all(["conv-detail", "convs"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
			if (alive.current) after?.();
		} catch (error) {
			if (alive.current) setError(chatError(error));
		} finally {
			if (alive.current) {
				onBusyChange(false);
				setProgress(null);
			}
		}
	}
	const status = error ? (
		<p role="alert" className="mx-4 my-3 text-small text-danger">
			{error}
		</p>
	) : null;
	const openMember = (id: string) => {
		setMemberId(id);
		setDuration(600);
		go("member");
	};

	if (panel === "nickname")
		return (
			<>
				<form
					className={`${box} flex flex-col gap-4 p-4`}
					onSubmit={(event) => {
						event.preventDefault();
						const error = validateGroupNickname(nickname);
						if (error) {
							setError(error);
							return;
						}
						void perform(
							() => chatApi.setNickname(d.id, nickname.trim() || null),
							() => go("home"),
						);
					}}
				>
					<Field
						label="我在本群的昵称"
						value={nickname}
						maxLength={64}
						disabled={busy}
						placeholder={me?.name ?? "使用账号名称"}
						onChange={(event) => setNickname(event.target.value)}
					/>
					<p className="text-caption text-muted">
						只在本群显示，不会更改账号名称。{Array.from(nickname.trim()).length}/32
					</p>
					<Button type="button" disabled={busy || !nickname} onClick={() => setNickname("")}>
						恢复账号名称
					</Button>
					<Button type="submit" variant="primary" disabled={busy || nickname.trim() === currentNickname}>
						{busy ? "保存中…" : "保存"}
					</Button>
				</form>
				{status}
			</>
		);
	if (panel === "identity")
		return (
			<>
				<form
					className={`${box} flex flex-col gap-4 p-4`}
					onSubmit={(event) => {
						event.preventDefault();
						void perform(
							() => chatApi.update(d.id, { title: title.trim() }),
							() => go("home"),
						);
					}}
				>
					<Field
						label="群名称"
						value={title}
						maxLength={100}
						required
						disabled={busy}
						onChange={(event) => setTitle(event.target.value)}
					/>
					<Button
						type="submit"
						variant="primary"
						disabled={busy || !permissions.manage || !title.trim() || title.trim() === d.title}
					>
						{busy ? "保存中…" : "保存"}
					</Button>
				</form>
				{status}
			</>
		);
	if (panel === "invite") return <Invite d={d} />;
	if (panel === "members")
		return (
			<section className={box}>
				<h3 className="px-4 pt-4 pb-2 text-small text-muted">群成员 {d.members.length}</h3>
				{d.members.map((m) =>
					permissions.manage ? (
						<button type="button" key={m.id} className={row} onClick={() => openMember(m.id)}>
							<Avatar actor={m} size={36} />
							<MemberName member={m} />
							<span className="text-caption text-muted">
								{m.role === "owner" ? "群主" : m.role === "admin" ? "管理员" : ""}
							</span>
							<ChevronRight size={15} />
						</button>
					) : (
						<Link
							key={m.id}
							to={`/contacts/${entityRef(m)}`}
							state={internalState(loc)}
							aria-disabled={busy}
							onClick={(event) => {
								if (busy) event.preventDefault();
							}}
							className={row}
						>
							<Avatar actor={m} size={36} />
							<MemberName member={m} />
						</Link>
					),
				)}
			</section>
		);
	if ((panel === "member" || panel === "transfer") && member) {
		const muted = !!member.mutedUntil && member.mutedUntil > Date.now(),
			roleAllowed = canAssignRole(permissions.role, me?.id, member),
			muteAllowed = canMuteMember(permissions.role, me?.id, member);
		return (
			<>
				<section className={`${box} flex flex-col gap-4 p-4`}>
					<Link
						to={`/contacts/${entityRef(member)}`}
						state={internalState(loc)}
						aria-disabled={busy}
						onClick={(event) => {
							if (busy) event.preventDefault();
						}}
						className="press flex items-center gap-3"
					>
						<Avatar actor={member} size={44} />
						<MemberName member={member} />
						<ChevronRight size={16} />
					</Link>
					{panel === "transfer" ? (
						<>
							<p className="text-small leading-relaxed text-muted">
								将群主移交给 {member.name} 后，你将成为普通成员。之后可以退出并保留这个群聊。
							</p>
							<Button
								variant="primary"
								disabled={busy || !roleAllowed}
								onClick={() =>
									void perform(
										() => chatApi.setRole(d.id, member.id, "owner"),
										() => go("home"),
									)
								}
							>
								{busy ? "移交中…" : "确认移交"}
							</Button>
							<Button disabled={busy} onClick={() => go("member")}>
								取消
							</Button>
						</>
					) : (
						<>
							<p className="text-caption text-muted">
								{member.role === "owner" ? "群主" : member.role === "admin" ? "管理员" : "群成员"}
								{muted ? ` · 禁言至 ${new Date(member.mutedUntil as number).toLocaleString()}` : ""}
							</p>
							{roleAllowed && (
								<>
									<Button
										disabled={busy}
										onClick={() =>
											void perform(() => chatApi.setRole(d.id, member.id, member.role === "admin" ? "member" : "admin"))
										}
									>
										{member.role === "admin" ? "取消管理员" : "设为管理员"}
									</Button>
									<Button disabled={busy} onClick={() => go("transfer")}>
										移交群主
									</Button>
								</>
							)}
							{muteAllowed && (
								<>
									{muted && (
										<Button disabled={busy} onClick={() => void perform(() => chatApi.mute(d.id, member.id, 0))}>
											解除禁言
										</Button>
									)}
									<label className="flex items-center justify-between gap-3 text-small">
										禁言时长
										<select
											value={duration}
											disabled={busy}
											onChange={(event) => setDuration(Number(event.target.value) as MuteSeconds)}
											className="field h-10 rounded-control bg-ground px-3"
										>
											{MUTE_DURATIONS.map((item) => (
												<option key={item.seconds} value={item.seconds}>
													{item.label}
												</option>
											))}
										</select>
									</label>
									<Button disabled={busy} onClick={() => void perform(() => chatApi.mute(d.id, member.id, duration))}>
										{busy ? "处理中…" : muted ? "更新禁言时长" : "禁言"}
									</Button>
								</>
							)}
							{!roleAllowed && !muteAllowed && <p className="text-caption text-muted">此成员没有可用的管理操作。</p>}
						</>
					)}
				</section>
				{status}
			</>
		);
	}
	if (panel === "leave" || panel === "dissolve") {
		const dissolves = permissions.owner || panel === "dissolve";
		return (
			<>
				<section className={`${box} flex flex-col gap-4 p-4`}>
					<h3 className="text-body font-semibold">{dissolves ? "解散群聊？" : "退出群聊？"}</h3>
					<p className="text-small leading-relaxed text-muted">
						{dissolves
							? "解散后所有成员都将失去这个群聊的访问权限，无法恢复。你是群主，直接退出也会解散群聊。"
							: "退出后将无法查看或发送这个群聊的消息。"}
					</p>
					{permissions.owner && (
						<Button disabled={busy} onClick={() => go("members")}>
							先移交群主，保留群聊
						</Button>
					)}
					<Button
						className="text-danger"
						disabled={busy}
						onClick={() =>
							void perform(
								() => (panel === "dissolve" ? chatApi.dissolve(d.id) : chatApi.leave(d.id)),
								() => nav("/", { replace: true }),
							)
						}
					>
						{busy ? "处理中…" : dissolves ? "确认解散并退出" : "确认退出"}
					</Button>
					<Button disabled={busy} onClick={() => go("home")}>
						取消
					</Button>
				</section>
				{status}
			</>
		);
	}
	return (
		<>
			<section className={`${box} p-4`}>
				<div className="flex items-center gap-3">
					<button
						type="button"
						disabled={!permissions.manage || busy}
						aria-label={permissions.manage ? "更换群头像" : "群头像"}
						className="press relative rounded-control"
						onClick={() => input.current?.click()}
					>
						<GroupAvatar url={d.avatarUrl} title={d.title} size={56} />
						{permissions.manage && (
							<span className="absolute -right-1 -bottom-1 rounded-full bg-raised p-1 text-muted">
								<Camera size={13} />
							</span>
						)}
					</button>
					<button
						type="button"
						disabled={!permissions.manage || busy}
						aria-label={permissions.manage ? "编辑群名称" : "群名称"}
						className="press flex min-w-0 flex-1 items-center gap-2 text-left"
						onClick={() => {
							setTitle(d.title);
							go("identity");
						}}
					>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-body font-medium">{d.title}</span>
							<span className="text-caption text-muted">{d.members.length} 位成员</span>
						</span>
						{permissions.manage && <ChevronRight size={16} className="text-faint" />}
					</button>
				</div>
				{!permissions.hasOwner && <p className="mt-3 text-caption text-muted">该群尚未记录群主，暂不可管理。</p>}
				{progress !== null && (
					<p role="status" className="mt-3 text-caption text-muted">
						{progress === 100 ? "正在保存头像…" : `上传头像 ${progress}%`}
					</p>
				)}
				<input
					ref={input}
					type="file"
					accept="image/jpeg,image/png,image/webp"
					hidden
					aria-label="选择群头像"
					disabled={busy || !permissions.manage}
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = "";
						if (!file) return;
						void perform(async () => {
							setProgress(0);
							const avatarUrl = await uploadGroupAvatar(d.id, file, setProgress);
							await chatApi.update(d.id, { avatarUrl });
						});
					}}
				/>
				{d.avatarUrl && permissions.manage && (
					<button
						type="button"
						className="press mt-3 text-caption text-muted"
						disabled={busy}
						onClick={() => void perform(() => chatApi.update(d.id, { avatarUrl: null }))}
					>
						恢复默认头像
					</button>
				)}
			</section>
			{status}
			<section className={box}>
				<button type="button" className={row} disabled={busy} onClick={() => go("members")}>
					<span className="flex-1">群成员</span>
					<span className="text-muted">{d.members.length}</span>
					<ChevronRight size={15} className="text-faint" />
				</button>
				<ul className="grid grid-cols-4 gap-y-4 px-3 pt-2 pb-4">
					{d.members.slice(0, 8).map((m) => (
						<li key={m.id} className="min-w-0">
							<Link
								to={`/contacts/${entityRef(m)}`}
								state={internalState(loc)}
								aria-disabled={busy}
								onClick={(event) => {
									if (busy) event.preventDefault();
								}}
								className="press flex flex-col items-center gap-1.5 px-1"
							>
								<Avatar actor={m} size={42} />
								<span className="w-full text-center text-caption">
									<MemberName member={m} />
								</span>
							</Link>
						</li>
					))}
				</ul>
			</section>
			<section className={box}>
				<button type="button" className={row} disabled={busy} onClick={() => go("invite")}>
					<span className="flex-1">邀请入群</span>
					<ChevronRight size={15} className="text-faint" />
				</button>
			</section>
			<section className={box}>
				<button
					type="button"
					className={row}
					aria-label="编辑我在本群的昵称"
					disabled={busy || !me?.id}
					onClick={() => {
						setNickname(currentNickname);
						go("nickname");
					}}
				>
					<span className="flex-1">我在本群的昵称</span>
					<span className="max-w-28 truncate text-muted">{currentNickname || me?.name}</span>
					<ChevronRight size={15} className="shrink-0 text-faint" />
				</button>
			</section>
			{children}
			<section className={box}>
				{permissions.owner && (
					<button type="button" className={`${row} text-danger`} disabled={busy} onClick={() => go("dissolve")}>
						解散群聊
					</button>
				)}
				<button type="button" className={`${row} text-danger`} disabled={busy} onClick={() => go("leave")}>
					退出群聊
				</button>
			</section>
		</>
	);
}

function MemberName({ member }: { member: ConversationDetail["members"][number] }) {
	const name = groupMemberName(member);
	return (
		<span className="min-w-0 flex-1">
			<span className="block truncate">{name}</span>
			{name !== member.name && <span className="block truncate text-caption text-muted">{member.name}</span>}
		</span>
	);
}
