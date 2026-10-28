import { realpathSync } from "node:fs";

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
