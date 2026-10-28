import { useEffect, useReducer } from "react";
import { rpc } from "../transport/client";
import { mux } from "../transport/stream";
import type {
	BackgroundRow,
	ContextSnapshot,
	ModelStatus,
	SessionInfo,
	SessionSnapshot,
	SubtaskRow,
	TodoItem,
	UsageSnapshot,
	UsageTotals,
} from "../transport/types";
import { applyMessage, applyToolUpdate, type ChatItem, fromTranscript } from "./chat";

export interface SessionView {
	ready: boolean;
	session?: SessionInfo;
	items: ChatItem[];
	hasMore: boolean;
	running: boolean;
	model?: ModelStatus;
	usage?: UsageSnapshot;
	context?: ContextSnapshot;
	todos: TodoItem[];
	subtasks: SubtaskRow[];
	background: BackgroundRow[];
	error?: string;
}
const initial: SessionView = {
	ready: false,
	items: [],
	hasMore: false,
	running: false,
	todos: [],
	subtasks: [],
	background: [],
};

type Act =
	| { k: "reset" }
	| { k: "snapshot"; snap: SessionSnapshot }
	| { k: "ev"; type: string; data: Record<string, unknown> }
	| { k: "older"; items: ChatItem[]; hasMore: boolean };

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

/** 当前网关 sessions.watch 的 ready.result 是 terminal.info：model 为 {id,provider,contextWindow}，思考档在 config.resolved。 */
function modelOf(snap: SessionSnapshot): ModelStatus | undefined {
	const m = snap.model as (Partial<ModelStatus> & { id?: string }) | undefined;
	if (!m?.provider) return undefined;
	const thinking = m.thinking ?? snap.config?.resolved?.thinking;
	return {
		provider: m.provider,
		model: m.model ?? m.id ?? "",
		...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
		...(thinking ? { thinking } : {}),
		...(m.routedTo ? { routedTo: m.routedTo } : {}),
	};
}
/** 契约是 {self,children}；当前网关给扁平 UsageTotals。两种都收。 */
function usageOf(u: SessionSnapshot["usage"] | UsageTotals | undefined): UsageSnapshot | undefined {
	if (!u) return undefined;
	return "self" in u ? u : { self: u };
}

function reduce(s: SessionView, a: Act): SessionView {
	if (a.k === "reset") return initial;
	if (a.k === "older")
		return {
			...s,
			items: [...a.items, ...s.items.filter((i) => !a.items.some((o) => o.id === i.id))],
			hasMore: a.hasMore,
		};
	if (a.k === "snapshot") {
		const { snap } = a;
		return {
			...s,
			ready: true,
			session: snap.session ?? s.session,
			// 契约形状带 transcript；当前网关不带，由随后的 session.update snapshot 重建
			items: snap.transcript ? fromTranscript(snap.transcript.items) : s.items,
			hasMore: snap.transcript?.hasMore ?? s.hasMore,
			model: modelOf(snap) ?? s.model,
			usage: usageOf(snap.usage) ?? s.usage,
			context: snap.context ?? s.context,
		};
	}
	const d = a.data;
	switch (a.type) {
		case "session.update":
			// SAFETY: session.update 的 data 即 SDK SessionUpdate；reduceUpdate 对未知 type 直接忽略。
			return reduceUpdate(s, d as unknown as UpdateShape);
		case "usage.updated":
			return { ...s, usage: { self: d.totals as UsageTotals, children: s.usage?.children } };
		case "context.updated":
			// SAFETY: context.updated 的 data 形状见 contracts §3.3，与 ContextSnapshot 同字段。
			return { ...s, context: d as unknown as ContextSnapshot };
		case "model.changed":
			return { ...s, model: d.to as ModelStatus };
		case "todo.updated":
			return { ...s, todos: (d.items as TodoItem[]) ?? [] };
		case "subtask.updated":
			return { ...s, subtasks: (d.rows as SubtaskRow[]) ?? [] };
		case "background.updated":
			return { ...s, background: (d.rows as BackgroundRow[]) ?? [] };
		case "run.ended":
			return { ...s, running: false };
		default:
			return s;
	}
}

/** 订阅一个会话：sessions.watch 的快照 + 增量，断线重连由 mux 带游标补齐。 */
export function useSession(id: string | undefined): SessionView & { loadOlder(): void } {
	const [view, dispatch] = useReducer(reduce, initial);
	useEffect(() => {
		dispatch({ k: "reset" });
		if (!id) return;
		return mux.subscribe(
			"sessions.watch",
			{ id },
			{
				onReady: (result) => dispatch({ k: "snapshot", snap: result as SessionSnapshot }),
				onEvent: (type, data) => dispatch({ k: "ev", type, data: (data ?? {}) as Record<string, unknown> }),
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
					snap: { ...((r as { info?: SessionSnapshot }).info ?? {}), session: r.session } as SessionSnapshot,
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
