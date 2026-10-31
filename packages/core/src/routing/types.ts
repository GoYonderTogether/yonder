import type { Channel, OutputPart, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";
import type { NotificationConfig, NotificationLevel } from "../config/notifications.js";
import type { Runtime, RuntimeRun } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";

/** 已路由的一次提交：agent、原生会话与唤醒方式。 */
export type RoutedRun = { agent: string; session: string; wake: "run" | "write" };
export interface CreateRouterOptions {
	channels?: Map<string, Channel>;
	store: Store;
	sessions: Sessions;
	runtime: () => Runtime;
	agents: Map<string, AgentConfig>;
	notificationLevel?: (conv?: string, session?: string) => NotificationLevel;
	notifications?: NotificationConfig;
	socialBatchPlugin?: boolean | ReadonlySet<string>;
	onOwnerMention?: (session: SessionInfo, event: YEvent) => Promise<void>;
	onStart?: (
		session: SessionInfo,
		event: YEvent,
		waiter: boolean,
	) => ((part: OutputPart, runId?: string) => void) | undefined;
	onRun?: (session: SessionInfo, run: RuntimeRun, inputs: YEvent[], waiter: boolean) => void | Promise<void>;
	onCommand?: (session: SessionInfo, event: YEvent) => Promise<RunResult | undefined>;
	onReport?: (error: unknown) => void;
	/** Deprecation and no-binding diagnostics that are facts, not failures (spec 20 §3). */
	onWarn?: (message: string, data?: object) => void;
}
