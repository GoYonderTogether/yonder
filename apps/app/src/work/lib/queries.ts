import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { socialOrigin } from "../../api/http";
import type { Actor } from "../../api/types";
import { rpc } from "../api/client";
import { useActiveNode } from "../api/nodes";
import { mux } from "../api/stream";
import type { ActivitySummary, ApprovalCard, NodeFacts, SessionInfo, TranscriptItem } from "../api/types";
import { type ChatItem, fromTranscript } from "./chat";
import { titleOf } from "./identity";
import type { ImportList } from "./imports";

export const useFacts = () => useQuery({ queryKey: ["facts"], queryFn: () => rpc<NodeFacts>("capabilities.get") });

export const useSessions = () =>
	useQuery({
		queryKey: ["sessions"],
		queryFn: () => rpc<SessionInfo[]>("sessions.list", {}),
		refetchInterval: 5000,
	});

const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** 云端映射由设备登记产生，key 是本机 agent id，actor 是聊天使用的同一个账号。 */
export function useDeviceAgents() {
	const node = useActiveNode();
	return useQuery({
		queryKey: ["device-agents", node.id],
		enabled: !!node.deviceId,
		queryFn: async (): Promise<{ key: string; actor: Actor }[]> => {
			const response = await fetch(
				new URL(`api/devices/${encodeURIComponent(node.deviceId!)}/agents`, socialOrigin()),
				{
					credentials: "include",
				},
			);
			if (!response.ok) throw new Error("无法读取设备 Bot 身份");
			return response.json();
		},
		refetchInterval: 5000,
	});
}

export function deviceAgentMap(deviceId: string, agents: { key: string; actor: Actor }[]): Map<string, Actor> {
	return new Map(
		agents
			.filter(({ key, actor }) => key && actor.kind === "agent" && actor.deviceId === deviceId)
			.map(({ key, actor }) => [key, actor]),
	);
}

/** agent id → Bot 显示名。bots.list 需要 owner scope；没有权限或失败时为空表，标题退回 agent id。 */
export const useBotNames = () =>
	useQuery({
		queryKey: ["bot-names"],
		queryFn: async (): Promise<ReadonlyMap<string, string>> => {
			try {
				const r = await rpc<{ bots: { agent: string; name: string }[] }>("bots.list");
				return new Map(r.bots.map((b) => [b.agent, b.name]));
			} catch {
				return NO_NAMES;
			}
		},
		staleTime: 60_000,
	}).data ?? NO_NAMES;

/** 会话标题：Bot 用显示名。 */
export function useTitleOf() {
	const names = useBotNames();
	const node = useActiveNode();
	const agents = useDeviceAgents();
	const cloudNames = new Map(
		[...deviceAgentMap(node.deviceId ?? "", agents.data ?? [])].map(([key, actor]) => [key, actor.name]),
	);
	return (s: SessionInfo) => {
		const selected = node.deviceId ? cloudNames : names;
		return s.mode === "persistent" && s.agent ? (selected.get(s.agent) ?? s.agent) : titleOf(s, selected);
	};
}

export const useActivity = () =>
	useQuery({
		queryKey: ["activity"],
		queryFn: () => rpc<ActivitySummary>("activity.summary"),
		refetchInterval: 2500,
	});

/** 列表行用：会话最近一页 transcript（最后一条消息与未读数从它派生）。 */
export function useTail(id: string, nudge: string | undefined) {
	return useQuery({
		queryKey: ["tail", id, nudge],
		queryFn: async (): Promise<ChatItem[]> =>
			fromTranscript((await rpc<{ items: TranscriptItem[] }>("sessions.transcript", { id, limit: 30 })).items),
		staleTime: 4000,
	});
}

export const useApprovals = () =>
	useQuery({
		queryKey: ["approvals"],
		queryFn: () => rpc<{ items: ApprovalCard[] }>("approvals.list", { state: "pending" }),
		refetchInterval: 4000,
		retry: false,
	});

/** 重连成功后立即刷新所有查询，补齐断线期间的变化。 */
export function useRefetchOnReconnect() {
	const qc = useQueryClient();
	useEffect(() => {
		let was = mux.state;
		return mux.onState((s) => {
			if (s === "open" && was !== "open") void qc.invalidateQueries();
			was = s;
		});
	}, [qc]);
}

/** 导入的 pi 会话列表（imports.list，最近 100 个）；网关未提供时静默为空。 */
export const useImports = (enabled = true) =>
	useQuery({
		queryKey: ["imports"],
		queryFn: () => rpc<ImportList>("imports.list", { limit: 100 }),
		enabled,
		staleTime: 30_000,
		refetchInterval: 60_000,
		retry: false,
	});
