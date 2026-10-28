import type { Mode, Ref } from "./types.js";

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
