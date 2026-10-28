import { realpathSync } from "node:fs";
import type { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";

type Assistant = NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]>;
export type Message =
	| Assistant
	| { role: "user"; content: string | Array<{ type: string; text?: string }> }
	| {
			role: "toolResult";
			toolCallId: string;
			toolName: string;
			content: Array<{ type: string; text?: string }>;
			isError: boolean;
	  };

export interface ChatTarget {
	preset?: string;
	session?: string;
	channel?: string;
}

export const hideReplyMarker = (text: string, streaming: boolean) =>
	Boolean(text.trim()) && (streaming ? "NO_REPLY".startsWith(text.trim()) : text.trim() === "NO_REPLY");

export function sameDirectory(left: string, right: string): boolean {
	if (left === right) return true;
	try {
		return realpathSync(left) === realpathSync(right);
	} catch {
		return false;
	}
}
