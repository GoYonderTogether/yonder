import type { Attachment } from "./messages.js";
import type { SessionModels } from "./models.js";

export interface SubagentTaskRequest {
	preset: string;
	task: string;
	sources?: string[];
	effort?: string;
	credentialSlots?: SessionModels["credentialSlots"];
	attachments?: Attachment[];
}
