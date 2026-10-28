// 形状来自 proposals/unified-client/contracts.md（接口以它为准）。
// @yonder/gateway/protocol 就绪前在此手写；前端只读取，未知字段与未知事件一律容忍。
export type Mode = "main" | "persistent" | "task" | string;

export interface SessionInfo {
	id: string;
	agent: string | null;
	profile: string;
	mode: Mode;
	key: string;
	parent?: string;
	version: string;
	opened: string;
	closed?: string;
	close?: "run-end" | "manual";
}

export interface TranscriptItem {
	from?: string;
	id: number;
	kind: string;
	text: string;
	tools?: Array<{ name: string; args: object }>;
	event?: string;
}

export interface ModelRef {
	provider: string;
	model: string;
	thinking?: string;
}
export interface ModelStatus extends ModelRef {
	contextWindow?: number;
	routedTo?: ModelRef;
}
export interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}
export interface UsageSnapshot {
	self: UsageTotals;
	children?: UsageTotals;
}
export interface ContextSnapshot {
	tokens: number;
	window: number;
	percent: number;
	auto: boolean;
}
export interface TodoItem {
	id: string;
	text: string;
	state: "todo" | "doing" | "done" | "cancelled" | string;
	parent?: string;
	order: number;
}
export interface SubtaskRow {
	id: string;
	session: string;
	label: string;
	state: string;
	startedAt: string;
	lastOutputAt?: string;
}
export interface BackgroundRow {
	id: string;
	label: string;
	state: string;
	exitCode?: number;
	startedAt: string;
}
export interface ApprovalCard {
	approvalId: string;
	level: string;
	library: string;
	ref: string;
	field?: string;
	sink: string;
	reason?: string;
	session?: string;
	requestedAt: string;
	expiresAt: string;
	state: "pending" | "approved" | "denied" | "timeout" | string;
	answeredBy?: string;
}
export interface ActivitySummary {
	running: number;
	waiting: number;
	sessions: { id: string; state: "running" | "waiting" | "idle" | "error" | string; since: string }[];
}
export interface SessionSnapshot {
	session: SessionInfo;
	info?: unknown;
	transcript?: { items: TranscriptItem[]; hasMore: boolean };
	model?: ModelStatus;
	usage?: UsageSnapshot | UsageTotals;
	context?: ContextSnapshot;
	/** 当前网关附带的运行配置；只取思考档 */
	config?: { resolved?: { thinking?: string } };
	state?: unknown;
}
export interface NodeFacts {
	protocol: number;
	kind: "local" | "remote";
	version: { yonder: string; commit: string | null };
	methods: Record<string, { scope: string; stream?: true; since: number }>;
	events: string[];
	granted: string[];
	limits: { maxSubs: number; attachmentMaxBytes: number; transcriptPage: number };
}
export interface InputReceipt {
	event: string;
	session: string;
	deduped?: boolean;
}

export type ServerFrame =
	| { t: "ready"; sub: string; gap: boolean; cursor: string; result: unknown }
	| { t: "ev"; sub: string; seq: number; cursor: string; type: string; ts: string; data: unknown }
	| { t: "end"; sub: string; reason: string; error?: string }
	| { t: "pong"; n?: number };
