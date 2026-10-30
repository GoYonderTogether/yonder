import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { rpc } from "../api/client";
import { useActiveNode } from "../api/nodes";
import { mux } from "../api/stream";
import { useSessions } from "./queries";
import type { SessionView } from "./useSession";

export function hasRailContent(view: SessionView, children: boolean, views: boolean, attachments: boolean): boolean {
	return !!(
		view.todos.length ||
		view.subtasks.length ||
		view.background.length ||
		view.goal ||
		view.wakes?.length ||
		children ||
		views ||
		attachments
	);
}

export function viewHasContent(content: unknown): boolean {
	if (!content || typeof content !== "object") return false;
	const value = content as {
		type?: string;
		text?: string;
		items?: unknown[];
		rows?: unknown[];
		prompt?: string;
		payload?: unknown;
	};
	if (value.type === "markdown") return !!value.text?.trim();
	if (value.type === "list") return !!value.items?.length;
	if (value.type === "kv") return !!value.rows?.length;
	if (value.type === "choice" || value.type === "input") return !!value.prompt?.trim();
	return value.type === "builtin" && value.payload != null;
}

type Attachment = { kind: string; name?: string; uri: string };

export function useRailAttachments(session: string | undefined) {
	const node = useActiveNode();
	return useQuery({
		queryKey: ["rail-attachments", node.id, session],
		enabled: !!session,
		queryFn: async () => {
			const transcript = await rpc<{ items: { event?: string }[] }>("sessions.transcript", { id: session, limit: 50 });
			const ids = [...new Set(transcript.items.flatMap((item) => (item.event ? [item.event] : [])))];
			const pages = await Promise.all(
				ids.map((id) =>
					rpc<{ events: { routes?: { session?: string }[]; data?: { attachments?: Attachment[] } }[] }>(
						"events.query",
						{ query: { id } },
					),
				),
			);
			return pages.flatMap((page) =>
				page.events
					.filter((event) => event.routes?.some((route) => route.session === session))
					.flatMap((event) => event.data?.attachments ?? []),
			);
		},
		refetchInterval: 30000,
		retry: false,
	});
}

export function useRailContent(session: string | undefined, view: SessionView): boolean {
	const node = useActiveNode();
	const client = useQueryClient();
	const sessions = useSessions(!!session);
	const key = ["rail-content", node.id, session];
	const content = useQuery({
		queryKey: key,
		enabled: !!session,
		queryFn: async () => {
			const list = await rpc<{ views: { id: string; placement: string }[] }>("views.list", { session });
			const data = await Promise.allSettled(
				list.views
					.filter((item) => item.placement === "rail")
					.map((item) => rpc<{ content: unknown }>("views.data", { viewId: item.id, session })),
			);
			return data.some((result) => result.status === "fulfilled" && viewHasContent(result.value.content));
		},
		retry: false,
	});
	const attachments = useRailAttachments(session);
	useEffect(() => {
		if (!session) return;
		return mux.subscribe(
			"views.watch",
			{ session },
			{
				onReady: () => void client.invalidateQueries({ queryKey: ["rail-content", node.id, session] }),
				onEvent: () => void client.invalidateQueries({ queryKey: ["rail-content", node.id, session] }),
			},
		);
	}, [client, node.id, session]);
	const children = !!session && !!sessions.data?.some((item) => item.parent === session);
	return hasRailContent(view, children, content.data ?? false, !!attachments.data?.length);
}
