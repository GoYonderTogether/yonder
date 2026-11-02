import type { Attachment, Delivery, ToolContext } from "@yonder/sdk";

/**
 * One explicit send requested by a tool call (06). Declared here, with the port, because the send tool is L2 and
 * delivery is L3: delivery implements this contract, so the type travels upward, never downward.
 */
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

/**
 * What the core tools need from delivery: one explicit send on behalf of a tool call. Tools declare this narrow
 * port instead of importing the delivery service; the kernel passes in the real one, which carries the rest.
 */
export interface DeliveryPort {
	sendTool(ctx: ToolContext, request: MessageRequest): Promise<Delivery>;
}
