import type { SocialMessageData } from "./social.js";

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
