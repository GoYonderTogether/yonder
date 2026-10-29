import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Monitor, Settings } from "lucide-react";
import { Dialog } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../api";
import { SelfIdentity } from "../components/wallet/ContactDetail";
import { entityRef } from "../lib/entityRef";
import { internalState } from "../lib/navigation";
import { useLogout } from "../lib/useLogout";
import { $session } from "../store";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { toast } from "../ui/Toast";

function Sheet({
	open,
	onOpenChange,
	title,
	children,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	title: string;
	children: ReactNode;
}) {
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fade fixed inset-0 z-40 bg-black/30" />
				<Dialog.Content
					aria-describedby={undefined}
					className="rise fixed inset-x-0 bottom-0 z-50 flex flex-col gap-5 rounded-t-[24px] bg-raised p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-float outline-none md:inset-auto md:top-1/2 md:left-1/2 md:w-[420px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[24px]"
				>
					<Dialog.Title className="text-[20px] font-semibold tracking-tight">{title}</Dialog.Title>
					{children}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
	const s = useStore($session);
	const [name, setName] = useState(s?.actor.name ?? "");
	if (!s) return null;
	const save = async () => {
		try {
			$session.set({ actor: await api.updateProfile({ name: name.trim() }) });
			toast("已保存");
			onOpenChange(false);
		} catch (error) {
			toast(error instanceof Error ? error.message : "保存失败", true);
		}
	};
	return (
		<Sheet open={open} onOpenChange={onOpenChange} title="资料">
			<Avatar actor={s.actor} size={64} />
			<Field label="昵称" value={name} onChange={(e) => setName(e.target.value)} />
			<div className="flex gap-2">
				<Button variant="primary" disabled={!name.trim() || name.trim() === s.actor.name} onClick={save}>
					保存
				</Button>
				<Dialog.Close asChild>
					<Button variant="ghost">关闭</Button>
				</Dialog.Close>
			</div>
		</Sheet>
	);
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
	const logout = useLogout();
	const me = useStore($session)?.actor;
	const [profile, setProfile] = useState(false);
	return (
		<>
			<Sheet open={open && !profile} onOpenChange={onOpenChange} title="设置">
				{!me?.anonymous && (
					<Button className="h-11" onClick={() => setProfile(true)}>
						账号昵称
					</Button>
				)}
				<Button className="h-11 text-danger" onClick={logout}>
					退出登录
				</Button>
			</Sheet>
			{profile && <ProfileDialog open onOpenChange={setProfile} />}
		</>
	);
}

function Item({
	to,
	onClick,
	icon: Icon,
	label,
	value,
}: {
	to?: string;
	onClick?: () => void;
	icon: typeof Monitor;
	label: string;
	value?: string;
}) {
	const loc = useLocation();
	const body = (
		<>
			<Icon size={20} strokeWidth={1.75} className="text-muted" />
			<span className="flex-1 text-body">{label}</span>
			{value && <span className="text-small text-muted">{value}</span>}
			<ChevronRight size={16} className="text-faint" />
		</>
	);
	const cls = "press flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-tone-2";
	return to ? (
		<Link to={to} state={internalState(loc)} className={cls}>
			{body}
		</Link>
	) : (
		<button type="button" onClick={onClick} className={cls}>
			{body}
		</button>
	);
}

export function Me() {
	const s = useStore($session);
	const nav = useNavigate();
	const loc = useLocation();
	const [settings, setSettings] = useState(false);
	const { data: contacts = [] } = useQuery({
		queryKey: ["contacts"],
		queryFn: api.contacts,
		enabled: !!s && !s.actor.anonymous,
	});
	if (!s) return null;
	const agents = contacts.filter((a) => a.kind === "agent" && a.ownerId === s.actor.id);
	return (
		<div className="scroll-y h-full bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-[24px] lg:shadow-soft">
			<SelfIdentity />
			<div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pb-24 lg:px-8 lg:pb-10">
				{s.actor.anonymous ? (
					<Button variant="primary" onClick={() => nav("/login")}>
						注册 / 登录
					</Button>
				) : (
					<>
						<section aria-label="我的 Agent" className="overflow-hidden rounded-card bg-raised">
							<div className="flex items-center justify-between px-5 pt-4 pb-2">
								<h2 className="text-small font-medium text-muted">我的 Agent</h2>
								<span className="text-caption text-muted">{agents.length} 位</span>
							</div>
							<div className="divide-y divide-hairline">
								{agents.slice(0, 3).map((a) => (
									<Link
										key={a.id}
										to={`/contacts/${entityRef(a)}`}
										state={internalState(loc)}
										className="press flex items-center gap-3 px-5 py-4 hover:bg-tone/60"
									>
										<Avatar actor={a} size={44} online={!!a.online} />
										<div className="min-w-0 flex-1">
											<p className="truncate font-medium">{a.name}</p>
											<p className="mt-1 text-caption text-muted">
												{a.online ? "在线" : "离线"} · {a.public ? "公开" : "仅自己可见"}
											</p>
											{a.summary && <p className="mt-1 line-clamp-2 text-small text-muted">{a.summary}</p>}
										</div>
										<span className="flex items-center gap-1 text-small text-muted">
											管理
											<ChevronRight size={16} />
										</span>
									</Link>
								))}
							</div>
							{agents.length > 3 && (
								<Link
									to="/contacts?tab=agents"
									state={internalState(loc)}
									className="press flex items-center justify-between border-t border-hairline px-5 py-3 text-small hover:bg-tone/60"
								>
									查看全部 {agents.length} 位<ChevronRight size={16} />
								</Link>
							)}
							{!agents.length && <p className="px-5 py-4 text-small text-muted">连接设备后，Agent 会出现在这里</p>}
						</section>
						<div className="overflow-hidden rounded-card bg-raised">
							<Item to="/contacts?tab=devices" icon={Monitor} label="设备" />
						</div>
						{!agents.length && (
							<div className="flex gap-2">
								<Link to="/connect" state={internalState(loc)} className="contents">
									<Button className="h-11 flex-1">添加设备</Button>
								</Link>
								<Link to="/get" className="contents">
									<Button className="h-11 flex-1">下载 Yonder</Button>
								</Link>
							</div>
						)}
					</>
				)}
				<div className="overflow-hidden rounded-card bg-raised">
					<Item onClick={() => setSettings(true)} icon={Settings} label="设置" />
				</div>
			</div>
			<SettingsDialog open={settings} onOpenChange={setSettings} />
		</div>
	);
}
