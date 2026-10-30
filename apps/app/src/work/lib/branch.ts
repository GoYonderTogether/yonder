import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { Conversation } from "../../api/types";
import { rpc } from "../api/client";
import { useActiveNode } from "../api/nodes";
import type { SessionInfo } from "../api/types";
import { channelName, channelType } from "./chat";

type Source = { data?: { kind?: string; name?: string }; routes?: { session?: string }[] };

export function branchReference(session: SessionInfo) {
	const match = /^(?:conv:|from:)((?:conv|acct):([^:]+):(.+))$/.exec(session.key);
	return match ? { ref: match[1]!, channel: match[2]!, id: match[3]! } : undefined;
}

export function branchLabel(session: SessionInfo, events: Source[], conversations: Conversation[]): string {
	const ref = branchReference(session);
	if (!ref) return "来源未知 · 会话类型未知";
	const source = events.find((event) => event.routes?.some((route) => route.session === session.id));
	const conversationId = channelType(ref.channel) === "card" ? ref.id.split(":").at(-1) : undefined;
	const conversation = conversations.find((item) => item.id === conversationId);
	const kind = conversation?.kind ?? source?.data?.kind;
	const kindLabel = kind === "group" ? "群聊" : kind === "dm" ? "私聊" : "会话类型未知";
	const name = conversation?.title || (kind === "dm" ? source?.data?.name : undefined);
	return `${channelName(ref.channel)} · ${kindLabel} · ${name || `会话 ${ref.id}`}`;
}

export function useBranchLabel(session: SessionInfo | undefined) {
	const ref = session && branchReference(session);
	const node = useActiveNode();
	const source = useQuery({
		queryKey: ["branch-source", node.id, session?.id],
		enabled: session?.mode === "persistent" && !!ref,
		queryFn: () =>
			rpc<{ events: Source[] }>("events.query", {
				query: {
					type: "message.in",
					...(ref?.ref.startsWith("conv:") ? { conv: ref.ref } : { from: ref?.ref }),
					agent: session?.agent,
					limit: 50,
				},
			}),
		staleTime: 30_000,
	});
	const conversations = useQuery({
		queryKey: ["branch-conversations", node.id],
		enabled: session?.mode === "persistent" && !!node.deviceId && !!ref && channelType(ref.channel) === "card",
		queryFn: api.conversations,
		staleTime: 30_000,
	});
	return session
		? branchLabel(session, source.data?.events ?? [], conversations.data ?? [])
		: "来源未知 · 会话类型未知";
}
