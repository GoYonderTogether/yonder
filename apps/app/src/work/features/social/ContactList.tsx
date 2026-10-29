import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Laptop, Monitor, Plus, Server, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { contactRowMenu } from "../../../lib/contactMenu";
import { type Actor, type Device, httpApi } from "../../api/social";
import { type MenuAnchor, useMenuTrigger } from "../../lib/useLongPress";
import { href } from "../../shell/routes";
import { ActionMenu } from "../../ui/ActionMenu";
import { toast } from "../../ui/kit/Toast";
import { DeviceSheet } from "./DeviceSheet";
import { SocialAvatar, Status } from "./IdentityAvatar";
import { contactGroups } from "./lib/contactGroups";

const tabs = [
	{ id: "friends", label: "好友" },
	{ id: "agents", label: "Agent" },
	{ id: "devices", label: "设备" },
] as const;
type Tab = (typeof tabs)[number]["id"];

/** 8 个字母一屏的对齐：行高 56、图标 40、左右 10。与名片站 wallet/ContactList 同参数。 */
const ROW = "press flex w-full min-h-14 items-center gap-3 rounded-control px-2.5 py-2 text-left hover:bg-tone/60";

/** 固定行左侧的方形图标底：40×40、圆角 10、tone-2 底。 */
function Icon({ children }: { children: React.ReactNode }) {
	return (
		<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-tone-2 text-muted">
			{children}
		</span>
	);
}

/** 分组小标题：12px、muted、左侧缩进与行文字对齐。 */
function GroupHeader({ children }: { children: React.ReactNode }) {
	return <h2 className="flex items-center gap-2 px-2.5 py-1.5 text-caption text-muted">{children}</h2>;
}

function Row({
	onClick,
	lead,
	title,
	sub,
	trail,
}: {
	onClick?: () => void;
	lead: React.ReactNode;
	title: string;
	sub?: string | null;
	trail?: React.ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: 行内含按钮，外层不能再是 <button>（FP02 删除）
		<div
			role="button"
			tabIndex={0}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onClick?.();
				}
			}}
			className={`${ROW} cursor-pointer`}
		>
			{lead}
			<span className="min-w-0 flex-1">
				<span className="block truncate text-small font-medium">{title}</span>
				{sub && <span className="block truncate text-caption text-muted">{sub}</span>}
			</span>
			{trail}
		</div>
	);
}

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
				className={`${ROW} no-select`}
			>
				<SocialAvatar actor={a} size={40} online={a.kind === "agent" ? !!a.online : undefined} />
				<span className="min-w-0 flex-1">
					<span className="block truncate text-small font-medium">{a.name}</span>
					{(a.note || a.summary) && (
						<span className="block truncate text-caption text-muted">{a.note || a.summary}</span>
					)}
				</span>
			</a>
			{menu && <ActionMenu at={menu} title={a.name} actions={actions} onClose={() => setMenu(null)} />}
		</li>
	);
}

/** 好友列表：按拼音首字母分组，组标题与行左缩进一致。 */
function Friends({ list, meId }: { list: Actor[]; meId?: string }) {
	if (!list.length)
		return (
			<a href={href({ tab: "contacts", page: "friends/add" })} className={ROW}>
				<Icon>
					<UserPlus size={20} />
				</Icon>
				<span className="min-w-0 flex-1 text-small font-medium">添加朋友</span>
			</a>
		);
	return (
		<>
			{contactGroups(list).map(([key, group]) => (
				<section key={key}>
					<GroupHeader>{key}</GroupHeader>
					<ul>
						{group.map((a) => (
							<ContactRow key={a.id} a={a} meId={meId} />
						))}
					</ul>
				</section>
			))}
		</>
	);
}

/** Agent 列表：按所在设备分组，设备后的公开 Agent 单列。 */
function Agents({
	list,
	devices,
	meId,
	onAdd,
}: {
	list: Actor[];
	devices: Device[];
	meId?: string;
	onAdd: () => void;
}) {
	const own = list.filter((a) => a.ownerId === meId);
	const others = list.filter((a) => a.ownerId !== meId);
	const placed = new Set<string>();
	const groups = devices.map((device) => {
		const items = own.filter((a) => a.deviceId === device.id);
		for (const a of items) placed.add(a.id);
		return {
			key: device.id,
			head: (
				<>
					<span className="truncate">{device.name}</span>
					<span>· {deviceOnlineLabel(device)}</span>
					<Status online={device.online} className="h-1.5 w-1.5" />
				</>
			),
			items,
		};
	});
	const all = [
		...groups,
		{ key: "loose", head: <span>我的 Agent</span>, items: own.filter((a) => !placed.has(a.id)) },
		{ key: "others", head: <span>公开 Agent</span>, items: others },
	].filter((group) => group.items.length);
	if (!all.length)
		return (
			<Row
				onClick={onAdd}
				lead={
					<Icon>
						<Plus size={20} />
					</Icon>
				}
				title="添加设备"
			/>
		);
	return (
		<>
			{all.map((group) => (
				<section key={group.key}>
					<GroupHeader>{group.head}</GroupHeader>
					<ul>
						{group.items.map((a) => (
							<ContactRow key={a.id} a={a} meId={meId} />
						))}
					</ul>
				</section>
			))}
		</>
	);
}

const deviceOnlineLabel = (device: Device) => (device.kind === "cloud" || device.kind === "server" ? "云端" : "本地");

/** 设备行图标按设备类型选，和名片站 wallet/DeviceSheet 的 deviceIcon 同一组。 */
const DEVICE_ICON = { laptop: Laptop, desktop: Monitor, server: Server, cloud: Server } as const;

/** 设备列表：点开就是设备管理，开关不在列表行里（apps/app 没有行内开关这个交互）。 */
function Devices({
	devices,
	contacts,
	q,
	onAdd,
	onOpen,
}: {
	devices: Device[];
	contacts: Actor[];
	q: string;
	onAdd: () => void;
	onOpen: (device: Device) => void;
}) {
	const shown = devices.filter((d) => !q.trim() || d.name.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase()));
	return (
		<ul>
			{shown.map((device) => {
				const count = contacts.filter((a) => a.deviceId === device.id).length;
				const DeviceIcon = DEVICE_ICON[device.kind] ?? Monitor;
				return (
					<li key={device.id}>
						<Row
							onClick={() => onOpen(device)}
							lead={
								<Icon>
									<DeviceIcon size={20} />
								</Icon>
							}
							title={device.name}
							sub={`${deviceOnlineLabel(device)} · ${count} 个 Agent${device.current ? " · 本机" : ""}`}
							trail={<Status online={device.online} />}
						/>
					</li>
				);
			})}
			<li>
				<Row
					onClick={onAdd}
					lead={
						<Icon>
							<Plus size={20} />
						</Icon>
					}
					title="添加设备"
				/>
			</li>
		</ul>
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
	const hit = (name: string) => !q.trim() || name.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase());
	const friends = contacts.filter((a) => a.kind === "human" && hit(a.name));
	const agents = contacts.filter((a) => a.kind === "agent" && hit(a.name));
	const addDevice = () => {
		location.hash = href({ tab: "chats", page: "connect" });
	};
	return (
		<>
			<div className="flex flex-col">
				<a href={href({ tab: "contacts", page: "friends/add" })} className={ROW}>
					<Icon>
						<UserPlus size={20} />
					</Icon>
					<span className="min-w-0 flex-1 text-small font-medium">新的朋友</span>
				</a>
				{/* biome-ignore lint/a11y/useSemanticElements: 行内含按钮，外层不能再是 <button>（FP02 删除） */}
				<div
					role="button"
					tabIndex={0}
					aria-expanded={groupsOpen}
					onClick={() => setGroupsOpen(!groupsOpen)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							setGroupsOpen(!groupsOpen);
						}
					}}
					className={`${ROW} cursor-pointer`}
				>
					<Icon>
						<Users size={20} />
					</Icon>
					<span className="min-w-0 flex-1 text-small font-medium">群聊</span>
					<span className="flex items-center gap-1 text-caption text-faint">
						{groupsOpen && groups.data ? groups.data.filter((g) => g.kind === "group").length : ""}
						<ChevronRight
							size={16}
							className={groupsOpen ? "rotate-90 transition-transform" : "transition-transform"}
						/>
					</span>
				</div>
				{groupsOpen && (
					<div className="fade flex flex-col pl-6">
						{groups.isPending ? (
							<p className="px-2.5 py-2 text-caption text-muted">正在加载群聊…</p>
						) : groups.isError ? (
							<p role="alert" className="px-2.5 py-2 text-caption text-danger">
								加载群聊失败
							</p>
						) : (
							<>
								{groups.data
									.filter((g) => g.kind === "group")
									.map((g) => (
										<a
											key={g.id}
											href={href({ tab: "chats", page: "c", session: g.code ?? g.id })}
											className="press flex min-h-14 items-center gap-3 rounded-control px-2.5 py-2 text-left hover:bg-tone/60"
										>
											<Icon>
												<Users size={18} />
											</Icon>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-small font-medium">{g.title}</span>
												<span className="block truncate text-caption text-muted">{g.memberIds.length} 人</span>
											</span>
										</a>
									))}
								{!groups.data.some((g) => g.kind === "group") && (
									<a href={href({ tab: "contacts", page: "friends/add" })} className={ROW}>
										<Icon>
											<Plus size={18} />
										</Icon>
										<span className="min-w-0 flex-1 text-small font-medium">添加朋友</span>
									</a>
								)}
							</>
						)}
					</div>
				)}
			</div>
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
				<Devices devices={devices} contacts={contacts} q={q} onAdd={addDevice} onOpen={setDevice} />
			) : tab === "friends" && !friends.length ? (
				<div className="py-6 text-center text-muted" data-testid="contacts-empty">
					<p>暂无联系人</p>
					{/* 空态给下一步动作；「真的空」与「加载失败」不复用同一块文案。 */}
					<a className="mt-2 inline-block underline" href={href({ tab: "contacts", page: "friends/add" })}>
						添加好友
					</a>
				</div>
			) : tab === "agents" && !agents.length ? (
				<div className="py-6 text-center text-muted" data-testid="contacts-empty">
					<p>暂无 Agent</p>
					<a className="mt-2 inline-block underline" href={href({ tab: "contacts", page: "friends/add" })}>
						添加好友
					</a>
				</div>
			) : tab === "friends" ? (
				<Friends list={friends} meId={meId} />
			) : (
				<Agents list={agents} devices={devices} meId={meId} onAdd={addDevice} />
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
