import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { rpc } from "../api/client";
import type { TranscriptItem } from "../api/types";
import { workPath } from "../shell/workRoutes";

type SourceEvent = {
	id: string;
	ts: string;
	from?: string;
	conv?: string;
	data: {
		text?: string;
		msgId?: string;
		kind?: string;
		agent?: string;
		summary?: string;
		attachments?: { kind: string; name?: string }[];
	};
	routes?: {
		agent: string;
		session?: string;
		binding: string | null;
		wake?: string;
		busy?: string;
		waiting?: boolean;
		dropped?: string;
	}[];
};

/** Read the existing source events referenced by this session's durable transcript. */
export function SessionSources({ session, agent }: { session: string; agent?: string }) {
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
		refetchInterval: 5000,
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
			{agent && <BotSources agent={agent} />}
			<FoldedBatches agent={agent} />
			<SessionTrace session={session} />
			{query.data.hasMore && <p className="text-faint">仅显示最近 50 条转录对应的来源。</p>}
			{query.data.events.length === 0 && <p className="text-faint">最近转录没有可读取的来源事件。</p>}
			{query.data.events.map((event) => (
				<article key={event.id} className="rounded-control border border-hairline p-2">
					<p className="break-all text-caption text-faint">
						{event.ts} · {event.from ?? "未知来源"} · {event.conv ?? "无会话"}
					</p>
					<p className="whitespace-pre-wrap break-words">{event.data.text ?? ""}</p>
					{!!event.data.attachments?.length && (
						<p className="text-caption text-muted">
							附件 · {event.data.attachments.map((a) => a.name ?? a.kind).join("、")}
						</p>
					)}
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
								{route.waiting ? " · 等待结果" : ""}
							</p>
						))}
				</article>
			))}
		</div>
	);
}

function SessionTrace({ session }: { session: string }) {
	const [open, setOpen] = useState(false);
	const [after, setAfter] = useState<string>();
	const query = useQuery({
		queryKey: ["session-trace", session, after],
		queryFn: () =>
			rpc<{
				events: { id: string; ts: string; type: string; parent?: string; data: Record<string, unknown> }[];
				next?: string;
			}>("sessions.trace", { id: session, ...(after ? { after } : {}) }),
		enabled: open,
		retry: false,
	});
	return (
		<details onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="cursor-pointer text-muted">会话事件与投递</summary>
			{query.isPending && <p className="text-faint">加载事件中…</p>}
			{query.isError && (
				<p role="alert" className="text-danger">
					事件读取失败：{query.error.message}
				</p>
			)}
			{query.data && (
				<div className="space-y-2 pt-2">
					{query.data.events.length === 0 && <p className="text-faint">本页没有会话事件。</p>}
					{query.data.events.map((event) => (
						<details key={event.id} className="rounded-control border border-hairline p-2">
							<summary className="cursor-pointer break-all">
								{event.ts} · {event.type} · {event.id}
							</summary>
							{event.parent && <p className="break-all text-caption text-faint">来源事件 {event.parent}</p>}
							<pre className="overflow-auto whitespace-pre-wrap break-all text-caption">
								{JSON.stringify(event.data, null, 2)}
							</pre>
						</details>
					))}
					{after && (
						<button type="button" onClick={() => setAfter(undefined)} className="underline">
							回到第一页
						</button>
					)}
					{query.data.next && (
						<button type="button" onClick={() => setAfter(query.data.next)} className="ml-2 underline">
							下一页
						</button>
					)}
				</div>
			)}
		</details>
	);
}

/** Bot-wide routing records stay separate from the current session transcript. */
function BotSources({ agent }: { agent: string }) {
	const [open, setOpen] = useState(false);
	const [after, setAfter] = useState<string>();
	const query = useQuery({
		queryKey: ["bot-sources", agent, after],
		queryFn: () =>
			rpc<{ events: SourceEvent[]; next?: string }>("events.query", {
				query: { type: "message.in", agent, limit: 100, ...(after ? { after } : {}) },
			}),
		enabled: open,
		retry: false,
	});
	return (
		<details onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="cursor-pointer text-muted">Bot 级来源与路由（独立于当前会话）</summary>
			{query.isPending && <p className="text-faint">加载来源中…</p>}
			{query.isError && (
				<p role="alert" className="text-danger">
					来源读取失败：{query.error.message}
				</p>
			)}
			{query.data && (
				<div className="space-y-2 pt-2">
					{query.data.events.length === 0 && <p className="text-faint">没有可读取的来源事件。</p>}
					{query.data.events.map((event) => (
						<details key={event.id} className="rounded-control border border-hairline p-2">
							<summary className="cursor-pointer break-all">
								{event.ts} · {event.conv ?? "无会话"} · {event.data.kind ?? "未知类型"}
							</summary>
							<p className="break-all text-caption text-faint">
								{event.from ?? "未知来源"} · 事件 {event.id}
								{event.data.msgId ? ` · 平台消息 ${event.data.msgId}` : ""}
							</p>
							<p className="whitespace-pre-wrap break-words">{event.data.text ?? ""}</p>
							{!!event.data.attachments?.length && (
								<p>附件 · {event.data.attachments.map((a) => a.name ?? a.kind).join("、")}</p>
							)}
							{event.routes
								?.filter((route) => route.agent === agent)
								.map((route) => (
									<p key={route.agent} className="break-all text-caption text-muted">
										路由 {route.binding ?? "无绑定"} · {route.dropped ?? route.wake ?? "未知"}
										{route.busy ? ` · ${route.busy}` : ""}
										{route.session && (
											<>
												{" "}
												·{" "}
												<Link className="underline" to={workPath({ session: route.session })}>
													会话 {route.session}
												</Link>
											</>
										)}
									</p>
								))}
						</details>
					))}
					{after && (
						<button type="button" onClick={() => setAfter(undefined)} className="underline">
							回到第一页
						</button>
					)}
					{query.data.next && (
						<button type="button" onClick={() => setAfter(query.data.next)} className="ml-2 underline">
							下一页
						</button>
					)}
				</div>
			)}
		</details>
	);
}

function FoldedBatches({ agent }: { agent?: string }) {
	const [open, setOpen] = useState(false);
	const [after, setAfter] = useState<string>();
	const query = useQuery({
		queryKey: ["folded-batches", agent, after],
		queryFn: () =>
			rpc<{ events: SourceEvent[]; next?: string }>("events.query", {
				query: { type: "social.folded-ready", limit: 100, ...(after ? { after } : {}) },
			}),
		enabled: open && !!agent,
		retry: false,
	});
	if (!agent) return null;
	return (
		<details onToggle={(event) => setOpen(event.currentTarget.open)}>
			<summary className="cursor-pointer text-muted">群聊待整理批次</summary>
			{query.isPending && <p className="text-faint">加载批次中…</p>}
			{query.isError && (
				<p role="alert" className="text-danger">
					批次读取失败：{query.error.message}
				</p>
			)}
			{query.data?.events
				.filter((event) => event.data.agent === agent)
				.map((event) => (
					<p key={event.id} className="break-words">
						{event.ts} · {event.conv} · {event.data.summary ?? "待整理"}
					</p>
				))}
			{after && (
				<button type="button" onClick={() => setAfter(undefined)} className="underline">
					回到第一页
				</button>
			)}
			{query.data?.next && (
				<button type="button" onClick={() => setAfter(query.data?.next)} className="ml-2 underline">
					下一页
				</button>
			)}
		</details>
	);
}
