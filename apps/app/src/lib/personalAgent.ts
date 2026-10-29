import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { atom } from "nanostores";
import { api } from "../api";
import { $session } from "../store";

const revision = atom(0);
const key = (account: string) => `yonder:personal-agent:${account}`;
export function selectPersonalAgent(account: string, agent: string) {
	localStorage.setItem(key(account), agent);
	revision.set(revision.get() + 1);
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
		/* Setup will offer selection again. */
	}
	return { ...query, agents, agent: agents.find((a) => a.id === selected), me };
}
