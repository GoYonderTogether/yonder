// ServerFrame is the WebSocket envelope, not a protocol payload.
export type {
	ActivitySummary,
	ApprovalCard,
	BackgroundRow,
	ContextSnapshot,
	InputReceipt,
	Mode,
	ModelRef,
	ModelStatus,
	NodeFacts,
	SessionInfo,
	SessionSnapshot,
	SubtaskRow,
	TodoItem,
	TranscriptItem,
	UsageSnapshot,
	UsageTotals,
} from "@yonder/gateway/protocol";

export type ServerFrame =
	| { t: "ready"; sub: string; gap: boolean; cursor: string; result: unknown }
	| { t: "ev"; sub: string; seq: number; cursor: string; type: string; ts: string; data: unknown }
	| { t: "end"; sub: string; reason: string; error?: string }
	| { t: "pong"; n?: number };
