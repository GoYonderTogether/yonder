import type { NotificationIntent, SocialMessageData } from "./social.js";
import type { Ref, YEvent } from "./types.js";

export interface Attachment {
	kind: "image" | "audio" | "video" | "file";
	mime: string;
	uri: string;
	name?: string;
	bytes?: number;
}
export interface MessageInData {
	kind: string;
	text: string;
	attachments?: Attachment[];
	mentions?: Ref[];
	/** Display names the platform attached to `mentions`, keyed by account ref; the kernel never infers them. */
	mentionNames?: Record<string, string>;
	senderIsBot?: boolean;
	mentioned?: boolean;
	social?: SocialMessageData;
	msgId?: string;
	/** Original channel send time in epoch milliseconds; event.ts is acceptance time. */
	createdAt?: string;
	replyTo?: string;
	/** Quoted message the sender replied to, as the platform exposes it (text only). */
	quote?: { text?: string };
	name?: string;
	target?: string;
	/** Source event ids quoted by agent_ask (06 §6.1). */
	sources?: string[];
}

export interface TranscriptItem {
	attachments?: Attachment[];
	from?: string;
	timestamp?: number;
	/** Existing prepared-input edit, attached to its original transcript entry. */
	target?: number;
	prepared?: string;
	id: number;
	kind: string;
	text: string;
	tools?: Array<{ name: string; args: object }>;
	event?: string;
}

export interface OutMessage {
	/** Stable delivery attempt identifier, reused on retry. */
	deliveryId?: string;
	notification?: NotificationIntent;
	text: string;
	/** Optional platform-native structured content. When absent, channels send text as markdown. */
	content?:
		| { type: "text" | "markdown"; text: string; mentions?: string[]; mentionAll?: boolean }
		| { type: "image"; url: string; name?: string }
		| { type: "file"; url: string; name: string; bytes?: number }
		| { type: "error"; text: string }
		| {
				type: "interactive";
				title: string;
				body: string;
				actions: Array<{ id: string; label: string; link?: string }>;
				state: "pending" | "done";
				link?: string;
		  };
	/** Semantic reply target: verified internal inbound event ID; does not force a quote. */
	respondTo?: string;
	/** Verified account refs to notify in the target conversation. */
	mentions?: Ref[];
	/** Automatic reply source; explicit replyTo still forces a quoted reply. */
	sourceMessageId?: string;
	attachments?: Attachment[];
	replyTo?: string;
}
export interface Delivery {
	ok: boolean;
	/** Transient failure before any part was sent. Never combine with id or uncertain. */
	retryable?: boolean;
	uncertain?: boolean;
	id?: string;
	error?: string;
}
export type OutputPart =
	| { type: "message_start"; id: string }
	| { type: "message_end"; text: string }
	| { type: "text"; delta: string }
	| { type: "tool"; phase: "start" | "end"; name: string; label?: string; ok?: boolean }
	| { type: "final"; text: string }
	| { type: "error"; message: string };

/** Confirmed bot speech only: transport errors never become conversation history. */
export function isUserVisibleBotSpeech(event: Pick<YEvent, "type" | "data">): boolean {
	const data = event.data as { content?: { type?: string }; delivery?: { ok?: boolean } };
	return (
		(event.type === "message.out" || (event.type.startsWith("channel-") && event.type.endsWith(".anchor-updated"))) &&
		data.delivery?.ok === true &&
		data.content?.type !== "error"
	);
}
