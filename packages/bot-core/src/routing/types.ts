import type { AgentConfig } from "@yonder/bot-definition";
import type { NotificationConfig, NotificationLevel } from "@yonder/bot-definition/notifications";
import type { Runtime, RuntimeRun } from "@yonder/runtime-adapter/types";
import type { Channel, OutputPart, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/contracts.js";
import type { ParticipationHooks } from "./social.js";

/** 已路由的一次提交：agent、原生会话与唤醒方式。 */
export type RoutedRun = { agent: string; session: string; wake: "run" | "write" };
export interface CreateRouterOptions {
	channels?: Map<string, Channel>;
	store: Store;
	sessions: Sessions;
	runtime: () => Runtime;
	agents: Map<string, AgentConfig>;
	/** Registered hooks by plugin id: the participation policy plugin is selected by `SocialPolicy.plugin`. */
	participationHooks?: ParticipationHooks;
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
