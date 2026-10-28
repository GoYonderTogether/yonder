import { useQuery } from "@tanstack/react-query";
import { rpc } from "../api/client";
import type { TranscriptItem } from "../api/types";

type SourceEvent = {
	id: string;
	ts: string;
	from?: string;
	conv?: string;
	data: { text?: string; msgId?: string; kind?: string };
	routes?: {
		agent: string;
		session?: string;
		binding: string | null;
		wake?: string;
		busy?: string;
		dropped?: string;
	}[];
};

/** Read the existing source events referenced by this session's durable transcript. */
export function SessionSources({ session }: { session: string }) {
	const query = useQuery({
		queryKey: ["session-sources", session],
		queryFn: async () => {
			const transcript = await rpc<{ items: TranscriptItem[]; hasMore: boolean }>("sessions.transcript", {
				id: session,
				limit: 50,
			});
			const ids = [...new Set(transcript.items.map((item) => item.event).filter((id): id is string => !!id))];
			const pages = await Promise.all(
				ids.map((id) => rpc<{ events: SourceEvent[] }>("events.query", { query: { id } })),
			);
			return {
				events: pages
					.flatMap((page) => page.events)
					.filter((event) => event.routes?.some((r) => r.session === session)),
				hasMore: transcript.hasMore,
			};
		},
		retry: false,
	});
	if (query.isPending) return <p className="p-3 text-small text-faint">加载来源中…</p>;
	if (query.isError)
		return (
			<p role="alert" className="p-3 text-small text-danger">
				来源读取失败：{query.error.message}
			</p>
		);
	return (
		<div className="max-h-80 space-y-2 overflow-auto p-3 text-small">
			{query.data.hasMore && <p className="text-faint">仅显示最近 50 条转录对应的来源。</p>}
			{query.data.events.length === 0 && <p className="text-faint">最近转录没有可读取的来源事件。</p>}
			{query.data.events.map((event) => (
				<article key={event.id} className="rounded-control border border-hairline p-2">
					<p className="break-all text-caption text-faint">
						{event.ts} · {event.from ?? "未知来源"} · {event.conv ?? "无会话"}
					</p>
					<p className="whitespace-pre-wrap break-words">{event.data.text ?? ""}</p>
					<p className="break-all text-caption text-faint">
						事件 {event.id}
						{event.data.msgId ? ` · 平台消息 ${event.data.msgId}` : ""}
						{event.data.kind ? ` · ${event.data.kind}` : ""}
					</p>
					{event.routes
						?.filter((route) => route.session === session)
						.map((route) => (
							<p key={`${route.agent}:${route.binding}`} className="break-all text-caption text-muted">
								路由 {route.agent} · {route.binding ?? "无绑定"} · {route.dropped ?? route.wake ?? "未知"}
								{route.busy ? ` · ${route.busy}` : ""}
							</p>
						))}
				</article>
			))}
		</div>
	);
}
