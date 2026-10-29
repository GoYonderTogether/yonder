import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router";
import { rpc } from "../api/client";
import type { SessionInfo } from "../api/types";
import { ChannelIcon } from "../features/messages/ChannelIcon";
import { titleOf } from "../lib/identity";
import { workPath } from "../shell/workRoutes";

interface Overview {
	channels: { id: string; label: string; kind: string; lastActiveAt?: number }[];
	sessions: { session: SessionInfo }[];
}

/** 契约 §18 bots.overview；节点未实现时如实空态，不造数据。 */
function useOverview(bot: string) {
	return useQuery({
		queryKey: ["bot-overview", bot],
		queryFn: () => rpc<Overview>("bots.overview", { bot }),
		retry: false,
	});
}

function Body({ bot }: { bot: string }) {
	const q = useOverview(bot);
	if (q.isLoading) return <p className="px-4 py-3 text-small text-faint">加载中…</p>;
	if (q.isError || !q.data)
		return (
			<p className="px-4 py-3 text-small text-faint" data-testid="overview-empty">
				此节点还没有提供渠道与子会话列表（bots.overview 未实现）。
			</p>
		);
	const { channels, sessions } = q.data;
	return (
		<div className="scroll-y min-h-0 flex-1">
			<h3 className="px-4 pt-3 pb-1 text-caption text-faint">渠道</h3>
			{channels.length === 0 && <p className="px-4 py-1 text-small text-faint">还没有接入渠道</p>}
			{channels.map((c) => (
				<div key={c.id} className="flex items-center gap-2 px-4 py-2 text-small">
					<ChannelIcon channel={c.id} size={16} />
					{c.label}
				</div>
			))}
			<h3 className="px-4 pt-3 pb-1 text-caption text-faint">子会话</h3>
			{sessions.length === 0 && <p className="px-4 py-1 text-small text-faint">没有子会话</p>}
			{sessions.map(({ session }) => (
				<Link
					key={session.id}
					to={workPath({ session: session.id })}
					className="press block truncate px-4 py-2 text-small hover:bg-tone/60"
				>
					{titleOf(session)}
				</Link>
			))}
		</div>
	);
}

/** Bot 主对话的「渠道与子会话」面板：桌面右侧面板，移动端底部抽屉。 */
export function ChannelPanel({ bot, wide, onClose }: { bot: string; wide: boolean; onClose(): void }) {
	useEffect(() => {
		const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		addEventListener("keydown", key);
		return () => removeEventListener("keydown", key);
	}, [onClose]);
	const head = (
		<header className="flex items-center border-b border-hairline px-4 py-2">
			<h2 className="flex-1 text-body font-semibold">渠道与子会话</h2>
			<button
				type="button"
				onClick={onClose}
				aria-label="关闭"
				className="press grid size-8 place-items-center rounded-full"
			>
				<X size={18} aria-hidden />
			</button>
		</header>
	);
	if (wide)
		return (
			<aside
				className="flex w-[300px] shrink-0 flex-col border-l border-hairline bg-list"
				data-testid="channel-panel"
				aria-label="渠道与子会话"
			>
				{head}
				<Body bot={bot} />
			</aside>
		);
	return (
		<div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/30" data-testid="channel-sheet">
			<button type="button" aria-label="关闭" className="flex-1" onClick={onClose} />
			<div
				role="dialog"
				aria-modal="true"
				aria-label="渠道与子会话"
				className="flex max-h-[70%] min-h-[40%] flex-col rounded-t-card bg-list pb-[env(safe-area-inset-bottom)]"
			>
				{head}
				<Body bot={bot} />
			</div>
		</div>
	);
}
