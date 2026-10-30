import type { Attachment } from "./messages.js";
import type { Delivery, Mode, Ref } from "./types.js";

export interface SessionOpenData {
	session: string;
	mode: Mode;
	key: string;
	profile: string;
}
export interface SessionCloseData {
	session: string;
	reason: string;
}
export interface SessionInputData {
	session: string;
	text: string;
}
export interface IdentityLinkData {
	account: Ref;
	person: Ref;
	linked: boolean;
}
export interface ConfigReloadData {
	file: string;
	ok: boolean;
	errors?: string[];
}

export interface MessageOutData {
	text: string;
	attachments?: Attachment[];
	session?: string;
	to?: Ref;
	delivery: Delivery;
}
export interface RunEndData {
	session: string;
	runId?: string;
	inputs: string[];
	status: "done" | "error" | "aborted" | "limit";
	reason?: string;
	replied: "source" | "caller" | "deliver" | "none";
	model: string;
	/** Thinking level this run actually used. */
	thinking?: string;
	/** Present when a delegation asked for a per-run effort (14 §5). */
	effort?: { requested: string; effective: string; reason?: string; inputs: string[] };
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
}
