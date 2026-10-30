import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkedServerBase } from "./client.js";
import { privateWrite } from "./private-write.js";

export interface Config {
	person?: string | null;
	allowedUsers?: string[];
	credential?: string;
	peerId?: string;
	botId?: string;
	streaming?: boolean;
}
export interface State {
	base: string;
	cursor: string;
	peer?: string;
	bot?: string;
	token?: string;
	person?: string | null;
	linked?: boolean;
	contexts: Record<string, string>;
	seen: Record<string, string>;
}
export async function readState(directory: string): Promise<State | undefined> {
	try {
		const saved: State = JSON.parse(await readFile(join(directory, "account.json"), "utf8"));
		if (typeof saved.cursor !== "string" || !saved.contexts || !saved.seen) throw new Error();
		checkedServerBase(saved.base);
		return saved;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			throw new Error("Invalid private iLink state; restore it before continuing");
	}
	return undefined;
}

export function statusView(
	id: string,
	state: State,
	loginState: unknown,
	loginStatus: string | undefined,
	person: string | null,
	lastPoll: string | undefined,
	failure: string | undefined,
	stopped: boolean,
): object {
	return {
		instance: id,
		paired: Boolean(state.peer && state.linked),
		loginPending: Boolean(loginState),
		loginStatus: loginStatus ?? null,
		peer: state.peer ?? null,
		person,
		contextAvailable: Boolean(state.peer && state.contexts[state.peer]),
		lastPoll: lastPoll ?? null,
		error: failure ?? null,
		transport: "ilink-long-poll",
		groups: false,
		voiceOutput: "audio-file",
		audioInput: "silk-to-wav-or-original",
		stopped: stopped,
	};
}

export function queueSave(directory: string, state: State, tail: Promise<void>): Promise<void> {
	const value = JSON.stringify(state);
	return tail.catch(() => {}).then(() => privateWrite(join(directory, "account.json"), JSON.parse(value)));
}
