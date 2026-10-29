import { useEffect, useReducer } from "react";
import { rpc } from "../api/client";
import { emptySessionState, reduceSessionState, type SessionState } from "../api/session-state";
import { mux } from "../api/stream";
import type { SessionInfo, SessionSnapshot } from "../api/types";
import { applyMessage, applyToolUpdate, type ChatItem, fromTranscript } from "./chat";

/** 会话视图：转录/运行态在本地维护，元信息（用量、上下文、模型、todo…）归约见 api/session-state。 */
export interface SessionView extends SessionState {
	ready: boolean;
	session?: SessionInfo;
	items: ChatItem[];
	hasMore: boolean;
	running: boolean;
	error?: string;
}
export const emptyView: SessionView = {
	...emptySessionState(),
	ready: false,
	items: [],
	hasMore: false,
	running: false,
};

type Act =
	| { k: "reset" }
	/** stream=true：来自 sessions.watch 的 ready（不是 sessions.show 的元信息刷新），成功后清掉订阅结束的提示。 */
	| { k: "snapshot"; snap: SessionSnapshot; gap: boolean; stream?: boolean }
	| { k: "ev"; type: string; data: Record<string, unknown> }
	| { k: "older"; items: ChatItem[]; hasMore: boolean }
	| { k: "end"; reason: string };

/**
 * 服务端 end 帧（contracts §2.2）的 reason → 界面提示。
 * error 时 mux 会带游标自动重订（§2.4），所以文案说「正在重试」；其余 reason 不自动重订，如实说明。
 * 未知 reason 只给通用提示，不把原始值直接塞进界面。
 */
const END_TEXT: Record<string, string> = {
	forbidden: "没有权限查看这个会话",
	error: "会话连接出错，正在重试…",
	closed: "会话订阅已结束，已显示最后收到的内容",
	shutdown: "节点正在关闭，连接已断开",
};
const endText = (reason: string): string => END_TEXT[reason] ?? "会话订阅已结束，已显示最后收到的内容";

interface UpdateShape {
	type: string;
	id?: string;
	message?: Record<string, unknown>;
	messages?: Array<{ id: string; message: Record<string, unknown> }>;
	items?: Array<{ id: string; message?: Record<string, unknown> }>;
	streaming?: boolean;
	running?: boolean;
	tool?: Parameters<typeof applyToolUpdate>[1];
	error?: string;
}

function reduceUpdate(s: SessionView, u: UpdateShape): SessionView {
	let items = s.items;
	switch (u.type) {
		case "snapshot": {
			const list = u.items?.flatMap((i) => (i.message ? [{ id: i.id, message: i.message }] : [])) ?? u.messages ?? [];
			items = [];
			for (const m of list) items = applyMessage(items, m.id, m.message);
			return { ...s, items, running: u.running ?? s.running };
		}
		case "message":
			if (u.message) items = applyMessage(items, u.id ?? "live", u.message, u.streaming);
			return { ...s, items };
		case "tool":
			if (u.tool) items = applyToolUpdate(items, u.tool);
			return { ...s, items };
		case "state":
			return { ...s, running: u.running ?? s.running };
		case "error":
			return { ...s, error: u.error, running: false };
		case "end":
			return { ...s, running: false };
		default:
			return s; // 未知类型一律忽略
	}
}

/** 元信息动作走 api/session-state 的共享 reducer，这里只并入转录与运行态字段。 */
function withMeta(s: SessionView, action: Parameters<typeof reduceSessionState>[1]): SessionView {
	const meta = reduceSessionState(s, action);
	return meta === s ? s : { ...s, ...meta };
}

/** 纯 reducer：导出只为本目录外的单测能直接验证 gap 重置语义。 */
export function reduce(s: SessionView, a: Act): SessionView {
	if (a.k === "reset") return emptyView;
	if (a.k === "older")
		return {
			...s,
			items: [...a.items, ...s.items.filter((i) => !a.items.some((o) => o.id === i.id))],
			hasMore: a.hasMore,
		};
	if (a.k === "end") return { ...s, running: false, error: endText(a.reason) };
	if (a.k === "snapshot") {
		const { snap, gap } = a;
		// gap=true：服务端丢了游标，本地增量全部作废，只按快照重建（contracts §2.3.3）。
		// ready.result 带 transcript 时直接重建；否则等随后的 session.update snapshot。
		const chat: SessionView = {
			...s,
			ready: true,
			session: snap.session ?? s.session,
			items: snap.transcript ? fromTranscript(snap.transcript.items) : gap ? [] : s.items,
			hasMore: snap.transcript?.hasMore ?? (gap ? false : s.hasMore),
			// 一次成功的流快照说明订阅已经恢复（例如 end{error} 之后 mux 带游标重订成功），清掉上次的结束提示。
			// sessions.show 的元信息刷新不改 error：它不是订阅恢复的证据。
			error: a.stream || gap ? undefined : s.error,
		};
		return withMeta(chat, { k: "snapshot", snap, gap });
	}
	const d = a.data;
	switch (a.type) {
		case "session.update":
			// SAFETY: session.update 的 data 即 SDK SessionUpdate；reduceUpdate 对未知 type 直接忽略。
			return reduceUpdate(s, d as unknown as UpdateShape);
		case "run.ended":
			return { ...s, running: false };
		default:
			// usage/context/model/todo/subtask/background/wake/goal/compaction：全量替换，未知类型忽略。
			return withMeta(s, { k: "event", type: a.type, data: d });
	}
}

/** 订阅一个会话：sessions.watch 的快照 + 增量，断线重连由 mux 带游标补齐。 */
export type LiveView = SessionView & { loadOlder(): void };
export function useSession(id: string | undefined): LiveView {
	const [view, dispatch] = useReducer(reduce, emptyView);
	useEffect(() => {
		dispatch({ k: "reset" });
		if (!id) return;
		return mux.subscribe(
			"sessions.watch",
			{ id },
			{
				onReady: (result, gap) => dispatch({ k: "snapshot", snap: result as SessionSnapshot, gap, stream: true }),
				onEvent: (type, data) => dispatch({ k: "ev", type, data: (data ?? {}) as Record<string, unknown> }),
				// 服务端 end（forbidden/error/closed/shutdown/slow-consumer）不会再发 ready：不处理就会永远停在「连接中…」。
				onEnd: (reason) => dispatch({ k: "end", reason }),
			},
		);
	}, [id]);
	// 当前网关不推 usage.updated：一轮结束后拉一次元信息刷新底栏用量
	const { running } = view;
	useEffect(() => {
		if (!id || running) return;
		const ctl = new AbortController();
		rpc<SessionSnapshot>("sessions.show", { id, include: "meta" }, ctl.signal)
			.then((r) =>
				dispatch({
					k: "snapshot",
					// sessions.show 是权威元信息，不是增量补齐，不算 gap。
					snap: { ...(r.info ?? {}), session: r.session } as unknown as SessionSnapshot,
					gap: false,
				}),
			)
			.catch(() => undefined);
		return () => ctl.abort();
	}, [id, running]);
	const loadOlder = () => {
		const first = view.items[0];
		const n = Number(first?.id.replace(/\D/g, ""));
		if (!id || !first || !Number.isFinite(n)) return;
		rpc<{ items: Parameters<typeof fromTranscript>[0]; hasMore: boolean }>("sessions.transcript", {
			id,
			before: n,
			limit: 50,
		})
			.then((r) => dispatch({ k: "older", items: fromTranscript(r.items), hasMore: r.hasMore }))
			.catch(() => undefined);
	};
	return { ...view, loadOlder };
}
