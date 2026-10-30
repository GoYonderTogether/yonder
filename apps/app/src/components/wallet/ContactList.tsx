import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../api";
import type { Actor } from "../../api/types";
import { cn } from "../../lib/cn";
import { contactRowMenu } from "../../lib/contactMenu";
import { entityRef } from "../../lib/entityRef";
import { internalState } from "../../lib/navigation";
import { socialLoadError } from "../../lib/socialError";
import { $session } from "../../store";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { toast } from "../../ui/Toast";
import type { ActionItem } from "../../work/lib/actions";
import { type MenuAnchor, useMenuTrigger } from "../../work/lib/useLongPress";
import { ActionMenu } from "../../work/ui/ActionMenu";

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

const Header = ({ children, desktop }: { children: ReactNode; desktop?: boolean }) => (
	<h2 className={cn("flex items-center gap-2 px-2.5 py-1.5 text-caption text-muted", !desktop && "px-2")}>
		{children}
	</h2>
);

function Row({
	to,
	lead,
	title,
	sub,
	active,
	menu,
}: {
	to: string;
	lead: ReactNode;
	title: string;
	sub?: string | null;
	active?: boolean;
	/** 右键、长按或 Shift+F10 打开的菜单 */
	menu?: ActionItem[];
}) {
	const loc = useLocation();
	const [at, setAt] = useState<MenuAnchor | null>(null);
	const trigger = useMenuTrigger(setAt);
	return (
		<>
			<Link
				to={to}
				state={internalState(loc)}
				className={cn(
					"press flex w-full min-h-14 items-center gap-3 rounded-control px-2.5 py-2 text-left hover:bg-tone/60",
					active && "bg-raised shadow-soft hover:bg-raised",
					menu && "no-select",
				)}
				{...(menu ? trigger : {})}
			>
				{lead}
				<span className="min-w-0 flex-1">
					<span className="block truncate text-small font-medium">{title}</span>
					{sub && <span className="block truncate text-caption text-muted">{sub}</span>}
				</span>
			</Link>
			{menu && at && <ActionMenu at={at} title={title} actions={menu} onClose={() => setAt(null)} />}
		</>
	);
}

const Icon = ({ children }: { children: ReactNode }) => (
	<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-tone-2 text-muted">
		{children}
	</span>
);

function ActorRow({ a, active }: { a: Actor; active?: boolean }) {
	const agent = a.kind === "agent";
	const nav = useNavigate();
	const loc = useLocation();
	const meId = useStore($session)?.actor.id;
	const profile = () => nav(`/contacts/${entityRef(a)}`, { state: internalState(loc) });
	const message = () => openDmWith(nav, a);
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

/** 打开与这个账号的私聊并跳进去；拿不到会话就提示原因，不留空白页。 */
async function openDmWith(nav: (to: string) => void, a: Actor) {
	try {
		const conv = await api.openDm(a.id);
		nav(`/c/${entityRef(conv)}`);
	} catch (error) {
		toast(error instanceof Error ? error.message : "无法打开会话", true);
	}
}

/** 我的 Bot：自有 Agent 一行一个，右侧「发消息」直接开私聊（资料页仍从名字进）。 */
function BotRow({ a }: { a: Actor }) {
	const nav = useNavigate();
	const loc = useLocation();
	const [busy, setBusy] = useState(false);
	const message = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await openDmWith(nav, a);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="flex min-h-14 items-center gap-3 rounded-control px-2.5 py-2 hover:bg-tone/60">
			<Avatar actor={a} size={40} online={!!a.online} />
			<Link to={`/contacts/${entityRef(a)}`} state={internalState(loc)} className="press min-w-0 flex-1 py-1">
				<span className="block truncate text-small font-medium">{a.name}</span>
				<span className="block truncate text-caption text-muted">{a.summary || (a.online ? "在线" : "离线")}</span>
			</Link>
			<Button size="sm" disabled={busy} onClick={() => void message()}>
				{busy ? "打开中…" : "发消息"}
			</Button>
		</div>
	);
}

function MyBots({ list }: { list: Actor[] }) {
	if (!list.length) return null;
	const sorted = [...list].sort((a, b) => collator.compare(a.name, b.name));
	return (
		<section data-testid="my-bots">
			<Header>我的 Bot</Header>
			{sorted.map((a) => (
				<BotRow key={a.id} a={a} />
			))}
		</section>
	);
}

/** 通讯录：好友（按首字母分组）+ 我的 Bot。群聊在「消息」，名片与设备在「我」。 */
export function ContactList({ q, active }: { q: string; active?: string }) {
	const me = useStore($session)?.actor;
	const { data, error, refetch } = useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
	// 已有数据时后台刷新失败不打断列表；只有拿不到联系人才显示失败。
	const failure = data ? null : error;
	const hit = (a: Actor) => !q.trim() || a.name.includes(q.trim());
	const friends = (data ?? []).filter((a) => a.kind === "human" && hit(a));
	// 我的 Bot：自己名下（含云端小歪）的 Agent；别人公开的 Bot 不在这里列。
	const bots = (data ?? []).filter((a) => a.kind === "agent" && a.ownerId === me?.id && hit(a));
	if (failure)
		return (
			<div className="flex flex-col items-start gap-3 px-2.5 py-4 text-small text-muted">
				<p role="alert">{socialLoadError(failure, "加载联系人失败")}</p>
				<Button onClick={() => void refetch()}>重试</Button>
			</div>
		);
	return (
		<>
			<Friends list={friends} active={active} />
			<MyBots list={bots} />
		</>
	);
}
