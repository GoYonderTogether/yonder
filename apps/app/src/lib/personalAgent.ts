import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { atom } from "nanostores";
import { api } from "../api";
import { $session } from "../store";

/** 每个新账号自动得到的默认 Bot：中文名「小歪」（小 y），英文名 Yonder Bot。 */
export const DEFAULT_BOT = { name: "小歪", englishName: "Yonder Bot" } as const;

const revision = atom(0);
const key = (account: string) => `yonder:personal-agent:${account}`;
export function selectPersonalAgent(account: string, agent: string) {
	localStorage.setItem(key(account), agent);
	revision.set(revision.get() + 1);
}

const ensuring = new Map<string, Promise<unknown>>();
/** 同一账号同一时刻只发一次；服务端另按账号加锁保证幂等，这里只避免本页重复请求。 */
export function ensureDefaultBot(account: string) {
	let pending = ensuring.get(account);
	if (!pending) {
		pending = api.ensureDefaultBot(DEFAULT_BOT).finally(() => ensuring.delete(account));
		ensuring.set(account, pending);
	}
	return pending;
}

export function usePersonalAgent() {
	const me = useStore($session)?.actor;
	useStore(revision);
	const query = useQuery({
		queryKey: ["contacts"],
		queryFn: api.contacts,
		enabled: !!me && !me.anonymous,
		refetchOnWindowFocus: true,
	});
	const agents = (query.data ?? []).filter((a) => a.kind === "agent" && a.ownerId === me?.id);
	let selected: string | null = null;
	try {
		if (me) selected = localStorage.getItem(key(me.id));
	} catch {
		/* Falls back to the first Bot. */
	}
	return { ...query, agents, agent: agents.find((a) => a.id === selected) ?? agents[0], me };
}
