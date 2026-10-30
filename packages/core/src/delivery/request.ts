import type { Attachment } from "@yonder/sdk";

export interface MessageRequest {
	to: string;
	via?: string;
	text: string;
	respondTo?: string;
	mentions?: string[];
	replyTo?: string;
	sourceMessageId?: string;
	attachments?: Attachment[];
	signal?: AbortSignal;
}
