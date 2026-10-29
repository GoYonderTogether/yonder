import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, UserPlus, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../api";
import type { Actor, Device } from "../../api/types";
import { deviceLabel } from "../../lib/cardItems";
import { cn } from "../../lib/cn";
import { contactRowMenu } from "../../lib/contactMenu";
import { entityRef } from "../../lib/entityRef";
import { internalState } from "../../lib/navigation";
import { AddDeviceDialog } from "../../pages/Connect";
import { $session } from "../../store";
import { Avatar, Status } from "../../ui/Avatar";
import { toast } from "../../ui/Toast";
import type { ActionItem } from "../../work/lib/actions";
import { type MenuAnchor, useMenuTrigger } from "../../work/lib/useLongPress";
import { ActionMenu } from "../../work/ui/ActionMenu";
import { DeviceSheet, deviceIcon, Switch } from "./DeviceSheet";

export type ContactTab = "friends" | "agents" | "devices";
export const TABS: { id: ContactTab; label: string }[] = [
	{ id: "friends", label: "好友" },
	{ id: "agents", label: "Agent" },
	{ id: "devices", label: "设备" },
];

const LETTERS = "ABCDEFGHJKLMNOPQRSTWXYZ";
const BOUNDS = [..."阿八嚓哒妸发旮哈讥咔垃痳拏噢妑七呥扨它穵夕丫帀"];
const collator = new Intl.Collator("zh-Hans-u-co-pinyin");
/** 名字的首字母分组；中文按拼音声母，其余归 #。 */
function letterOf(name: string) {
	const c = [...name.trim()][0] ?? "";
	if (/[a-z]/i.test(c)) return c.toUpperCase();
	if (/[一-龥]/.test(c)) {
		let found = -1;
		BOUNDS.forEach((b, i) => {
			if (collator.compare(b, c) <= 0) found = i;
		});
		return found >= 0 ? LETTERS[found] : "#";
	}
	return "#";
}

function useContactData() {
	const qc = useQueryClient();
	const { data: contacts = [] } = useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
	const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: api.devices });
	const { data: convs = [] } = useQuery({ queryKey: ["convs"], queryFn: api.conversations });
	const refresh = () => {
		for (const key of ["contacts", "devices", "actors"]) qc.invalidateQueries({ queryKey: [key] });
	};
	return { contacts, devices, groups: convs.filter((c) => c.kind === "group"), refresh };
}

const Header = ({ children, desktop }: { children: ReactNode; desktop?: boolean }) => (
	<h2 className={cn("flex items-center gap-2 px-2.5 py-1.5 text-caption text-muted", !desktop && "px-2")}>
		{children}
	</h2>
);

function Row({
	to,
	onClick,
	lead,
	title,
	sub,
	trail,
	active,
	menu,
}: {
	to?: string;
	onClick?: () => void;
	lead: ReactNode;
	title: string;
	sub?: string | null;
	trail?: ReactNode;
	active?: boolean;
	/** 右键、长按或 Shift+F10 打开的菜单 */
	menu?: ActionItem[];
}) {
	const loc = useLocation();
	const [at, setAt] = useState<MenuAnchor | null>(null);
	const trigger = useMenuTrigger(setAt);
	const cls = cn(
		"press flex w-full min-h-14 items-center gap-3 rounded-control px-2.5 py-2 text-left hover:bg-tone/60",
		active && "bg-raised shadow-soft hover:bg-raised",
	);
	const body = (
		<>
			{lead}
			<span className="min-w-0 flex-1">
				<span className="block truncate text-small font-medium">{title}</span>
				{sub && <span className="block truncate text-caption text-muted">{sub}</span>}
			</span>
			{trail}
		</>
	);
	if (to)
		return (
			<>
				<Link to={to} state={internalState(loc)} className={cn(cls, menu && "no-select")} {...(menu ? trigger : {})}>
					{body}
				</Link>
				{menu && at && <ActionMenu at={at} title={title} actions={menu} onClose={() => setAt(null)} />}
			</>
		);
	return (
		// biome-ignore lint/a11y/useSemanticElements: 行内含按钮（开关等），外层不能再是 <button>
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
			className={cn(cls, "cursor-pointer")}
		>
			{body}
		</div>
	);
}

const Icon = ({ children }: { children: ReactNode }) => (
	<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-tone-2 text-muted">
		{children}
	</span>
);

/** 固定行：新的朋友、群聊（点开列出群会话）。 */
export function FixedRows() {
	const nav = useNavigate();
	const loc = useLocation();
	const { groups } = useContactData();
	const [open, setOpen] = useState(false);
	return (
		<div className="flex flex-col">
			<Row
				onClick={() => toast("新的朋友，即将推出")}
				lead={
					<Icon>
						<UserPlus size={20} />
					</Icon>
				}
				title="新的朋友"
			/>
			<Row
				onClick={() => setOpen(!open)}
				lead={
					<Icon>
						<Users size={20} />
					</Icon>
				}
				title="群聊"
				trail={
					<span className="flex items-center gap-1 text-caption text-faint">
						{groups.length || ""}
						<ChevronRight size={16} className={cn("transition-transform", open && "rotate-90")} />
					</span>
				}
			/>
			{open && (
				<div className="fade flex flex-col pl-6">
					{groups.map((g) => (
						<Row
							key={g.id}
							onClick={() => nav(`/c/${entityRef(g)}`, { state: internalState(loc) })}
							lead={
								<Icon>
									<Users size={18} />
								</Icon>
							}
							title={g.title}
							sub={`${g.memberIds.length} 人`}
						/>
					))}
					{!groups.length && (
						<Row
							to="/friends/add"
							lead={
								<Icon>
									<Plus size={18} />
								</Icon>
							}
							title="添加朋友"
						/>
					)}
				</div>
			)}
		</div>
	);
}

function ActorRow({ a, active }: { a: Actor; active?: boolean }) {
	const agent = a.kind === "agent";
	const nav = useNavigate();
	const loc = useLocation();
	const meId = useStore($session)?.actor.id;
	const profile = () => nav(`/contacts/${entityRef(a)}`, { state: internalState(loc) });
	const message = async () => {
		try {
			const conv = await api.openDm(a.id);
			nav(`/c/${entityRef(conv)}`);
		} catch (error) {
			toast(error instanceof Error ? error.message : "无法打开会话", true);
		}
	};
	return (
		<Row
			menu={contactRowMenu({ actor: a, meId, message: () => void message(), profile })}
			to={`/contacts/${entityRef(a)}`}
			active={active}
			lead={<Avatar actor={a} size={40} online={agent ? !!a.online : undefined} />}
			title={a.name}
			sub={a.note ?? (agent ? a.summary : null)}
		/>
	);
}

function Friends({ list, active }: { list: Actor[]; active?: string }) {
	if (!list.length)
		return (
			<Row
				to="/friends/add"
				lead={
					<Icon>
						<UserPlus size={20} />
					</Icon>
				}
				title="添加朋友"
			/>
		);
	const sorted = [...list].sort((a, b) => collator.compare(a.name, b.name));
	const groups = new Map<string, Actor[]>();
	for (const a of sorted) {
		const l = letterOf(a.name);
		groups.set(l, [...(groups.get(l) ?? []), a]);
	}
	const keys = [...groups.keys()].sort((a, b) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));
	return (
		<>
			{keys.map((l) => (
				<section key={l}>
					<Header>{l}</Header>
					{groups.get(l)!.map((a) => (
						<ActorRow key={a.id} a={a} active={a.id === active} />
					))}
				</section>
			))}
		</>
	);
}

function Agents({
	list,
	devices,
	meId,
	active,
	onAdd,
}: {
	list: Actor[];
	devices: Device[];
	meId: string;
	active?: string;
	onAdd: () => void;
}) {
	const own = list.filter((a) => a.ownerId === meId);
	const others = list.filter((a) => a.ownerId !== meId);
	const placed = new Set<string>();
	const groups = devices.map((d) => {
		const items = own.filter((a) => a.deviceId === d.id);
		for (const a of items) placed.add(a.id);
		return {
			key: d.id,
			head: (
				<>
					<span className="truncate">{d.name}</span>
					<span>· {deviceLabel(d)}</span>
					<Status online={d.online} className="h-1.5 w-1.5" />
				</>
			),
			items,
		};
	});
	const loose = own.filter((a) => !placed.has(a.id));
	const all = [
		...groups,
		{ key: "loose", head: <span>我的 Agent</span>, items: loose },
		{ key: "others", head: <span>公开 Agent</span>, items: others },
	].filter((g) => g.items.length);
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
			{all.map((g) => (
				<section key={g.key}>
					<Header>{g.head}</Header>
					{g.items.map((a) => (
						<ActorRow key={a.id} a={a} active={a.id === active} />
					))}
				</section>
			))}
		</>
	);
}

function Devices({
	devices,
	contacts,
	onAdd,
	refresh,
}: {
	devices: Device[];
	contacts: Actor[];
	onAdd: () => void;
	refresh: () => void;
}) {
	const [managing, setManaging] = useState<string>();
	const power = async (d: Device, v: boolean) => {
		try {
			await api.setDeviceOnline(d.id, v);
			refresh();
			toast(v ? `${d.name} 上的 Agent 已联网` : `${d.name} 上的 Agent 已断开`);
		} catch (error) {
			toast(error instanceof Error ? error.message : "更新失败", true);
		}
	};
	return (
		<>
			{devices.map((d) => {
				const I = deviceIcon[d.kind];
				const count = contacts.filter((a) => a.deviceId === d.id).length;
				return (
					<div key={d.id}>
						<Row
							onClick={() => setManaging(d.id)}
							lead={
								<Icon>
									<I size={20} />
								</Icon>
							}
							title={d.name}
							sub={`${deviceLabel(d)} · ${count} 个 Agent${d.current ? " · 本机" : ""}`}
							trail={
								<>
									<Status online={d.online} />
									{/* biome-ignore lint/a11y/noStaticElementInteractions: 只拦截冒泡，不让开关的点击触发整行 */}
									<span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
										<Switch on={d.online} onChange={(v) => power(d, v)} label={`${d.name} 联网`} />
									</span>
								</>
							}
						/>
						<DeviceSheet
							key={d.name + d.online}
							device={d}
							agents={count}
							open={managing === d.id}
							onOpenChange={(v) => !v && setManaging(undefined)}
							onChanged={refresh}
						/>
					</div>
				);
			})}
			<Row
				onClick={onAdd}
				lead={
					<Icon>
						<Plus size={20} />
					</Icon>
				}
				title="添加设备"
			/>
		</>
	);
}

/** 好友 / Agent / 设备。手机一次显示一栏（tab），桌面三段连排。 */
export function ContactList({
	q,
	tab,
	desktop,
	active,
	meId,
}: {
	q: string;
	tab: ContactTab;
	desktop?: boolean;
	active?: string;
	meId: string;
}) {
	const { contacts, devices, refresh } = useContactData();
	const [adding, setAdding] = useState(false);
	const hit = (a: Actor) => !q.trim() || a.name.includes(q.trim());
	const friends = contacts.filter((a) => a.kind === "human" && hit(a));
	const agents = contacts.filter((a) => a.kind === "agent" && hit(a));
	const shownDevices = devices.filter((d) => !q.trim() || d.name.includes(q.trim()));
	const section = (id: ContactTab) =>
		id === "friends" ? (
			<Friends list={friends} active={active} />
		) : id === "agents" ? (
			<Agents list={agents} devices={devices} meId={meId} active={active} onAdd={() => setAdding(true)} />
		) : (
			<Devices devices={shownDevices} contacts={contacts} onAdd={() => setAdding(true)} refresh={refresh} />
		);
	return (
		<>
			{desktop
				? TABS.map((t) => (
						<section key={t.id} className="mb-2">
							<h2 className="px-2.5 py-1.5 text-[13px] font-semibold">{t.label}</h2>
							{section(t.id)}
						</section>
					))
				: section(tab)}
			<AddDeviceDialog open={adding} onOpenChange={setAdding} onConnected={refresh} />
		</>
	);
}
