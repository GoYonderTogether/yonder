import type { AgentConfig, Binding } from "@yonder/bot-definition";
import type { Runtime, RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import { type Channel, type Delivery, type Hook, parseRef, type SessionInfo, type YEvent } from "@yonder/sdk";
import type { ParticipationHooks } from "../routing/social.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/contracts.js";
import type { OutputQueue, ReplyText } from "./reply-text.js";
import type { MessageRequest } from "./request.js";

export interface DeliveryOptions {
	hooks?: Map<string, Hook[]>;
	/** Registered hooks by plugin id; the participation policy plugin is chosen by `SocialPolicy.plugin`. */
	participationHooks?: ParticipationHooks;
	store: Store;
	agents: Map<string, AgentConfig>;
	channels: Map<string, Channel>;
	runtime: () => Runtime;
	sessions: Sessions;
	onReport?: (error: unknown) => void;
	log?: (level: "info" | "warn" | "error", message: string, data?: object) => void;
}
export interface StreamState extends Pick<MessageRequest, "sourceMessageId"> {
	target: string;
	queue: OutputQueue;
	gate: ReplyText;
	delivery?: Promise<Delivery>;
	text: string;
	attempt?: string;
}
export interface StreamEntry {
	owner: string;
	message?: string;
	lastMessage?: string | undefined;
	visibleAt?: number;
	current?: StreamState | undefined;
	tail: Promise<void>;
}
export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const channelId = (ref: string) => {
	const parsed = parseRef(ref);
	return parsed.kind === "acct" || parsed.kind === "conv" ? parsed.channel : undefined;
};
export const fromSession = (session: SessionInfo) => (session.agent ? `agent:${session.agent}` : undefined);
export const selectedHooks = (hooks: Map<string, Hook[]> | undefined, config?: RuntimeSessionConfig) =>
	(config?.resolved.plugins ?? []).flatMap((id) => hooks?.get(id) ?? []).filter((hook) => !!hook.beforeSend);
export const bindingFor =
	(agents: Map<string, AgentConfig>) =>
	(session: SessionInfo, event: YEvent, config?: RuntimeSessionConfig): Binding | undefined => {
		const routes = event.routes?.find((route) => route.session === session.id && route.agent === session.agent);
		return session.agent
			? (config?.bindings ?? agents.get(session.agent)?.bindings)?.find((binding) => binding.id === routes?.binding)
			: undefined;
	};
export const waiting = (session: SessionInfo, event: YEvent) =>
	event.routes?.find((route) => route.session === session.id)?.waiting ?? (event.data as { waiting?: boolean }).waiting;
