import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { type Actor, type Device, httpApi } from "../../api/social";
import { contactRowMenu } from "../../lib/menus";
import { type MenuAnchor, useMenuTrigger } from "../../lib/useLongPress";
import { href } from "../../shell/routes";
import { ActionMenu } from "../../ui/ActionMenu";
import { ActorAvatar } from "../../ui/kit/ActorAvatar";
import { toast } from "../../ui/kit/Toast";
import { DeviceSheet } from "./DeviceSheet";
import { contactGroups } from "./lib/contactGroups";

const tabs = [
	{ id: "friends", label: "好友" },
	{ id: "agents", label: "Agent" },
	{ id: "devices", label: "设备" },
] as const;
type Tab = (typeof tabs)[number]["id"];

/** 联系人行：点按进资料，右键/长按弹菜单；发消息走 httpApi.openDm 再进会话。 */
function ContactRow({ a, meId }: { a: Actor; meId?: string }) {
	const [menu, setMenu] = useState<MenuAnchor | null>(null);
	const trigger = useMenuTrigger(setMenu);
	const open = () => {
		location.hash = href({ tab: "contacts", page: "contacts", session: a.code ?? a.id });
	};
	const message = async () => {
		try {
			const conv = await httpApi.openDm(a.id);
			location.hash = href({ tab: "chats", page: "c", session: conv.code ?? conv.id });
		} catch (e) {
			toast(e instanceof Error ? e.message : "无法打开会话", true);
		}
	};
	const actions = contactRowMenu({ actor: a, meId, message: () => void message(), profile: open });
	return (
		<li>
			<a
				href={href({ tab: "contacts", page: "contacts", session: a.code ?? a.id })}
				{...trigger}
				title={a.name}
				className="press no-select flex min-h-14 items-center gap-3 rounded-control px-2 py-2 hover:bg-tone"
			>
				<ActorAvatar seed={a.id} group="bot" size={40} dot={a.kind === "agent" && a.online} />
				<span className="min-w-0">
					<span className="block truncate font-medium">{a.name}</span>
					{(a.note || a.summary) && <span className="block truncate text-small text-muted">{a.note || a.summary}</span>}
				</span>
			</a>
			{menu && <ActionMenu at={menu} title={a.name} actions={actions} onClose={() => setMenu(null)} />}
		</li>
	);
}

export function ContactList({
	contacts,
	devices,
	meId,
	q,
}: {
	contacts: Actor[];
	devices: Device[];
	meId?: string;
	q: string;
}) {
	const [tab, setTab] = useState<Tab>("friends");
	const [device, setDevice] = useState<Device>();
	const [groupsOpen, setGroupsOpen] = useState(false);
	const groups = useQuery({ queryKey: ["convs"], queryFn: httpApi.conversations, enabled: groupsOpen });
	const qc = useQueryClient();
	const filtered = contacts.filter((a) => a.name.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()));
	const items = filtered.filter((a) => a.kind === (tab === "friends" ? "human" : "agent"));
	const row = (a: Actor) => <ContactRow key={a.id} a={a} meId={meId} />;
	return (
		<>
			<a
				href={href({ tab: "contacts", page: "friends/add" })}
				className="press mt-3 flex items-center gap-3 rounded-control p-3 hover:bg-tone"
			>
				<Plus size={20} />
				新的朋友
			</a>
			<button
				type="button"
				aria-expanded={groupsOpen}
				onClick={() => setGroupsOpen(!groupsOpen)}
				className="press flex w-full items-center gap-3 rounded-control p-3 text-left hover:bg-tone"
			>
				<Users size={20} />
				群聊
			</button>
			{groupsOpen && (
				<ul className="pl-8">
					{groups.isPending ? (
						<li>正在加载群聊…</li>
					) : groups.isError ? (
						<li role="alert">加载群聊失败</li>
					) : (
						groups.data
							.filter((g) => g.kind === "group")
							.map((g) => (
								<li key={g.id}>
									<a
										className="block rounded-control p-2 hover:bg-tone"
										href={href({ tab: "chats", page: "c", session: g.code ?? g.id })}
									>
										{g.title}
									</a>
								</li>
							))
					)}
				</ul>
			)}
			<div role="tablist" aria-label="分类" className="my-3 flex rounded-full bg-tone p-1">
				{tabs.map((t) => (
					<button
						type="button"
						key={t.id}
						role="tab"
						aria-selected={tab === t.id}
						onClick={() => setTab(t.id)}
						className={`press h-9 flex-1 rounded-full text-small ${tab === t.id ? "bg-raised font-medium shadow-soft" : "text-muted"}`}
					>
						{t.label}
					</button>
				))}
			</div>
			{tab === "devices" ? (
				<ul>
					{devices
						.filter((d) => d.name.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()))
						.map((d) => (
							<li key={d.id}>
								<button
									type="button"
									onClick={() => setDevice(d)}
									className="press flex w-full items-center gap-3 rounded-control p-3 text-left hover:bg-tone"
								>
									<span className="flex-1">
										{d.name}
										<span className="block text-small text-muted">
											{d.current ? "本机 · " : ""}
											{d.online ? "在线" : "离线"} · {contacts.filter((a) => a.deviceId === d.id).length} 个 Agent
										</span>
									</span>
								</button>
							</li>
						))}
					<li>
						<a href={href({ tab: "chats", page: "connect" })} className="block p-3">
							添加设备
						</a>
					</li>
				</ul>
			) : items.length ? (
				tab === "friends" ? (
					contactGroups(items).map(([key, list]) => (
						<section key={key}>
							<h2 className="px-2 py-1 text-small text-muted">{key}</h2>
							<ul>{list.map(row)}</ul>
						</section>
					))
				) : (
					<>
						<h2 className="px-2 py-1 text-small text-muted">我的 Agent</h2>
						<ul>{items.filter((a) => a.ownerId === meId).map(row)}</ul>
						<h2 className="px-2 py-1 text-small text-muted">公开 Agent</h2>
						<ul>{items.filter((a) => a.ownerId !== meId).map(row)}</ul>
					</>
				)
			) : (
				<p className="py-6 text-center text-muted">暂无{tab === "friends" ? "联系人" : "Agent"}</p>
			)}
			{device && (
				<DeviceSheet
					device={device}
					agents={contacts.filter((a) => a.deviceId === device.id).length}
					open
					onOpenChange={(v) => {
						if (!v) setDevice(undefined);
					}}
					onChanged={() => {
						void qc.invalidateQueries({ queryKey: ["contacts"] });
						void qc.invalidateQueries({ queryKey: ["devices"] });
						setDevice(undefined);
					}}
				/>
			)}
		</>
	);
}
