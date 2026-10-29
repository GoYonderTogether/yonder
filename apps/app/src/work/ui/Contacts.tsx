import { groupOf } from "../lib/identity";
import { useSessions, useTitleOf } from "../lib/queries";
import { href } from "../lib/useHash";
import { Avatar } from "./Avatar";

/**
 * 通讯录：契约还没有联系人接口，只列出 sessions.list 里真实存在的常驻 Bot。
 * 加载失败、真的没有 Bot 是三种不同状态：失败给错误与重试，空态给出下一步动作，不把失败画成空列表。
 */
export function Contacts() {
	const sessions = useSessions();
	const titleOf = useTitleOf();
	const bots = (sessions.data ?? []).filter((s) => groupOf(s) === "bot" && !s.closed);
	return (
		<div className="scroll-y h-full" data-testid="contacts">
			<h1 className="pt-safe px-4 pt-3 pb-1 text-title font-semibold">通讯录</h1>
			<h2 className="px-4 pt-2 pb-1 text-caption text-faint">本机 Bot</h2>
			{sessions.isLoading && <p className="px-4 py-2 text-small text-faint">加载中…</p>}
			{sessions.isError && (
				<div role="alert" className="px-4 py-2 text-small text-danger" data-testid="contacts-error">
					加载常驻 Bot 失败{" "}
					<button type="button" className="underline" onClick={() => void sessions.refetch()}>
						重试
					</button>
				</div>
			)}
			{sessions.data && bots.length === 0 && (
				<div className="px-4 py-2 text-caption text-faint" data-testid="contacts-empty">
					<p>没有常驻 Bot</p>
					<a className="mt-2 inline-block underline" href={href({ tab: "contacts", page: "friends/add" })}>
						添加好友
					</a>
				</div>
			)}
			{bots.map((s) => (
				<a
					key={s.id}
					href={href({ tab: "chats", session: s.id })}
					className="press flex items-center gap-3 px-4 py-2.5 hover:bg-tone/60"
				>
					<Avatar seed={s.agent ?? s.id} group="bot" size={36} />
					<span className="min-w-0 flex-1 truncate text-body">{titleOf(s)}</span>
				</a>
			))}
			<p className="px-4 py-4 text-caption text-faint">
				联系人、群组与好友需要 identity.* 之类的联系人接口，契约暂未提供。
			</p>
		</div>
	);
}
