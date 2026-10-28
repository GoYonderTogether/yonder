import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { rpc } from "../transport/client";
import { mux } from "../transport/stream";
import type { ActivitySummary, ApprovalCard, NodeFacts, SessionInfo, TranscriptItem } from "../transport/types";
import { type ChatItem, fromTranscript } from "./chat";
import type { ImportList } from "./imports";

export const useFacts = () => useQuery({ queryKey: ["facts"], queryFn: () => rpc<NodeFacts>("capabilities.get") });

export const useSessions = () =>
	useQuery({
		queryKey: ["sessions"],
		queryFn: () => rpc<SessionInfo[]>("sessions.list", {}),
		refetchInterval: 5000,
	});

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
