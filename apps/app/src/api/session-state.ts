import type {
	BackgroundRow,
	CompactionEv,
	ContextSnapshot,
	GoalUpdatedEv,
	ModelStatus,
	SessionSnapshot,
	SubtaskRow,
	TodoItem,
	UsageSnapshot,
	UsageTotals,
	WakeRow,
} from "@yonder/gateway/protocol";

/** goal.updated 的载荷；undefined=还没上报，null=明确没有目标。 */
export type Goal = NonNullable<GoalUpdatedEv["goal"]>;

/** 最近一次压缩：started 时 running=true，finished 带结果。 */
export interface CompactionState {
	kind: CompactionEv["kind"];
	before: number;
	after?: number;
	ms?: number;
	ok?: boolean;
	running: boolean;
}

/**
 * 会话元信息（contracts §3.3/§3.4/§15）。事件都是全量替换，未知事件一律忽略。
 * wakes/goal/compaction 在事件出现前保持未上报，不用空数组或零占位；todos 等沿用既有的必有数组。
 */
export interface SessionState {
	usage?: UsageSnapshot;
	context?: ContextSnapshot;
	model?: ModelStatus;
	todos: TodoItem[];
	subtasks: SubtaskRow[];
	background: BackgroundRow[];
	wakes?: WakeRow[];
	goal?: Goal | null;
	compaction?: CompactionState;
}

export function emptySessionState(): SessionState {
	return { todos: [], subtasks: [], background: [] };
}

/** 当前网关 sessions.watch 的 ready.result 是 terminal.info：model 为 {id,provider,contextWindow}，思考档在 config.resolved。 */
function modelOf(snap: SessionSnapshot): ModelStatus | undefined {
	const m = snap.model as (Partial<ModelStatus> & { id?: string }) | undefined;
	if (!m?.provider) return undefined;
	const configuredThinking = snap.config?.resolved?.thinking;
	const thinking = m.thinking ?? (typeof configuredThinking === "string" ? configuredThinking : undefined);
	return {
		provider: m.provider,
		model: m.model ?? m.id ?? "",
		...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
		...(thinking ? { thinking } : {}),
		...(m.routedTo ? { routedTo: m.routedTo } : {}),
	};
}

/**
 * 契约快照是 {self,children,last,lsp}，整体替换；旧网关的 sessions.show meta 只给扁平 UsageTotals，
 * 只有 self 一项，合并进已有快照，不丢掉事件补上的 children/last/lsp。
 */
function usageOf(u: SessionSnapshot["usage"] | UsageTotals, prev?: UsageSnapshot): UsageSnapshot | undefined {
	if (!u) return prev;
	if ("self" in u) return u;
	return prev ? { ...prev, self: u } : { self: u };
}

function compactionOf(d: Record<string, unknown>): Omit<CompactionState, "running"> | undefined {
	const e = d as Partial<CompactionEv>;
	// 形状不对就当没发生，不补默认值。
	if (typeof e.kind !== "string" || typeof e.before !== "number") return undefined;
	return {
		kind: e.kind,
		before: e.before,
		...(e.after !== undefined ? { after: e.after } : {}),
		...(e.ms !== undefined ? { ms: e.ms } : {}),
		...(e.ok !== undefined ? { ok: e.ok } : {}),
	};
}

export type SessionStateAction =
	| { k: "reset" }
	| { k: "snapshot"; snap: SessionSnapshot; gap: boolean }
	| { k: "event"; type: string; data: Record<string, unknown> };

/** 纯 reducer：useSession 与 useSessionState 共用，gap 语义只在这里定义一次。 */
export function reduceSessionState(s: SessionState, a: SessionStateAction): SessionState {
	if (a.k === "reset") return emptySessionState();
	if (a.k === "snapshot") {
		const { snap, gap } = a;
		// gap=true：服务端丢了游标，本地增量全部作废，只按快照重建（contracts §2.3.3）。
		const prev = gap ? undefined : s;
		return {
			usage: snap.usage ? usageOf(snap.usage, prev?.usage) : prev?.usage,
			context: snap.context ?? prev?.context,
			model: modelOf(snap) ?? prev?.model,
			todos: gap ? [] : s.todos,
			subtasks: gap ? [] : s.subtasks,
			background: gap ? [] : s.background,
			wakes: gap ? undefined : s.wakes,
			goal: gap ? undefined : s.goal,
			compaction: gap ? undefined : s.compaction,
		};
	}
	const d = a.data;
	switch (a.type) {
		case "usage.updated": {
			const totals = d.totals as UsageTotals | undefined;
			if (!totals) return s;
			const prev = s.usage;
			// 子 Agent 汇总单独一条（contracts §3.3）。没有 self 快照时无处挂载，等下一次 self 事件，不补零。
			if (d.scope === "children") {
				return prev ? { ...s, usage: { ...prev, children: totals } } : s;
			}
			// last 是会话最近一条助手消息；快照只有一份，children 事件不覆盖它。
			const last = d.last as UsageSnapshot["last"] | undefined;
			return { ...s, usage: { ...(prev ?? {}), self: totals, ...(last ? { last } : {}) } };
		}
		case "context.updated":
			// SAFETY: context.updated 的 data 形状见 contracts §3.3，与 ContextSnapshot 同字段。
			return { ...s, context: d as unknown as ContextSnapshot };
		case "model.changed": {
			const to = d.to as ModelStatus | undefined;
			return to ? { ...s, model: to } : s;
		}
		case "todo.updated":
			return { ...s, todos: (d.items as TodoItem[]) ?? [] };
		case "subtask.updated":
			return { ...s, subtasks: (d.rows as SubtaskRow[]) ?? [] };
		case "background.updated":
			return { ...s, background: (d.rows as BackgroundRow[]) ?? [] };
		case "wake.updated":
			return { ...s, wakes: (d.rows as WakeRow[]) ?? [] };
		case "goal.updated":
			// 没有 goal 字段的帧不当成「明确没有目标」。
			return Object.hasOwn(d, "goal") ? { ...s, goal: d.goal as Goal | null } : s;
		case "compaction.started":
		case "compaction.finished": {
			const compaction = compactionOf(d);
			if (!compaction) return s;
			return { ...s, compaction: { ...compaction, running: a.type === "compaction.started" } };
		}
		default:
			return s; // 未知类型一律忽略
	}
}

/** 底栏需要的字段（API-22 §17）；缺失即 undefined，由 format 决定是否展示。 */
export interface FooterStats {
	usage?: UsageTotals;
	/** 只来自真实的 usage.last.cacheHitPct，不按 totals 反推。 */
	cacheHitPct?: number;
	children?: UsageTotals;
	context?: ContextSnapshot;
	/** 没有 context 时的窗口回退（model.contextWindow）。 */
	contextWindow?: number;
	lsp?: { name: string; state: string };
	model?: ModelStatus;
}

export function footerStats(s: SessionState): FooterStats {
	const usage = s.usage?.self;
	const last = s.usage?.last;
	const lsp = s.usage?.lsp;
	const win = s.context?.window ?? s.model?.contextWindow;
	return {
		...(usage ? { usage } : {}),
		...(last ? { cacheHitPct: last.cacheHitPct } : {}),
		...(s.usage?.children ? { children: s.usage.children } : {}),
		...(s.context ? { context: s.context } : {}),
		...(win !== undefined ? { contextWindow: win } : {}),
		...(lsp ? { lsp } : {}),
		...(s.model ? { model: s.model } : {}),
	};
}
