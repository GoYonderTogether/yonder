import type { EventInput, EventPage, EventQuery, IdentityAPI, Ref, Route, YEvent } from "@yonder/sdk";
import type { QuotaStore } from "./quota.js";

export interface Store {
	notifications: import("./state.js").NotificationStore;
	budget: { read(session: string): Promise<import("./state.js").BudgetFacts> };
	events: {
		findInput: (input: EventInput) => Promise<YEvent | undefined>;
		append(event: YEvent): Promise<YEvent>;
		appendWithFacts(event: YEvent, facts: EventInput[]): Promise<YEvent>;
		record: (input: EventInput, routes?: Route[]) => Promise<YEvent>;
		firstTaskInputs(sessions: string[]): Promise<Map<string, string>>;
		runForInput(session: string, input: string): Promise<YEvent | undefined>;
		waitingInputs(session: string): Promise<YEvent[]>;
		agentResult(session: string, input: string): Promise<YEvent | undefined>;
		/** Existing channel receipts, card anchors and attempts; no second visibility ledger. */
		outputSince(session: string, target: string, after?: string, since?: string, account?: string): Promise<YEvent[]>;
		completionNotices(): Promise<YEvent[]>;
		runEnd(session: string, runId: string): Promise<YEvent | undefined>;
		/** Settlement and the completion marker share one transaction; duplicate runs do neither. */
		recordRun(
			input: EventInput & {
				data: {
					session: string;
					runId: string;
					[key: string]: unknown;
				};
			},
			settle?: (quota: QuotaStore) => Promise<void>,
		): Promise<boolean>;
		claimAttempt(
			input: EventInput & {
				data: {
					session?: string;
					runId?: string;
					target: string;
					message?: string;
					[key: string]: unknown;
				};
			},
		): Promise<string | undefined>;
		retryableAttempts(): Promise<YEvent[]>;
		unresolvedAttempts(): Promise<YEvent[]>;
		get(id: string): Promise<YEvent | undefined>;
		/**
		 * 事件日志的最大 id。走索引只读一行。
		 * 用来回答"有没有新事实"，比重新算一遍状态便宜几个数量级。
		 */
		watermark(): Promise<string | number | undefined>;
		query(query?: EventQuery): Promise<EventPage>;
	};
	sessions: {
		put(session: import("@yonder/sdk").SessionInfo): Promise<import("@yonder/sdk").SessionInfo>;
		get(id: string): Promise<import("@yonder/sdk").SessionInfo | undefined>;
		find(agent: string | null, key: string): Promise<import("@yonder/sdk").SessionInfo | undefined>;
		list(filter?: {
			agent?: string;
			mode?: import("@yonder/sdk").SessionInfo["mode"];
			open?: boolean;
			archived?: boolean;
			pinned?: boolean;
		}): Promise<import("@yonder/sdk").SessionInfo[]>;
		update(id: string, patch: import("./sessions.js").SessionWorkbench): Promise<void>;
		close: (id: string) => Promise<void>;
		setVersion: (id: string, version: string) => Promise<void>;
	};
	identity: (actor?: Ref) => IdentityAPI;
	readonly quota: {
		add(
			day: string,
			scope: import("./quota.js").QuotaScope,
			key: string,
			tokens: number,
			rounds?: number,
		): Promise<void>;
		get(day: string, scope: import("./quota.js").QuotaScope, key: string): Promise<import("./quota.js").QuotaCounters>;
	};
}
