import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

const PREFIX = "yonder-work-cache:";
const key = (account: string, device: string) =>
	`${PREFIX}${encodeURIComponent(account)}:${encodeURIComponent(device)}`;
const read = (name: string): unknown => {
	try {
		return JSON.parse(sessionStorage.getItem(name) ?? "null");
	} catch {
		return null;
	}
};
const write = (name: string, value: unknown) => {
	try {
		sessionStorage.setItem(name, JSON.stringify(value));
	} catch {
		/* Storage can be unavailable or full. */
	}
};
export function clearWorkCache() {
	try {
		for (const name of Object.keys(sessionStorage)) if (name.startsWith(PREFIX)) sessionStorage.removeItem(name);
	} catch {
		/* Storage unavailable. */
	}
}
export function removeWorkDevice(account: string, device: string) {
	try {
		const prefix = key(account, device);
		for (const name of Object.keys(sessionStorage))
			if (name === prefix || name.startsWith(`${prefix}:`)) sessionStorage.removeItem(name);
	} catch {
		/* Storage unavailable. */
	}
}
export function hasWorkCache(account: string, device: string): boolean {
	const all = read(`${PREFIX}${encodeURIComponent(account)}:all`) as ReturnType<typeof dehydrate> | null;
	return !!read(key(account, device)) || !!all?.queries?.some((query) => query.queryKey[2] === device);
}
export function saveWorkQueries(client: QueryClient, account: string, device: string) {
	const allowed = new Set(["facts", "sessions", "device-agents", "bot-profile", "all-work"]);
	write(
		key(account, device),
		dehydrate(client, {
			shouldDehydrateQuery: (q) =>
				q.state.data !== undefined &&
				allowed.has(String(q.queryKey[0])) &&
				(q.queryKey[0] !== "all-work" || (q.queryKey[1] === account && q.queryKey[2] === device)) &&
				(!["device-agents", "bot-profile"].includes(String(q.queryKey[0])) ||
					q.queryKey[1] === `account:${account}:device:${device}`),
		}),
	);
}
export function restoreWorkQueries(client: QueryClient, account: string, device: string) {
	const data = read(key(account, device));
	if (data && typeof data === "object") hydrate(client, data);
}
export function readWorkView<T>(account: string, device: string, session: string): T | null {
	return read(`${key(account, device)}:session:${encodeURIComponent(session)}`) as T | null;
}
export function saveWorkView(account: string, device: string, session: string, value: unknown) {
	const prefix = `${key(account, device)}:session:`;
	try {
		for (const name of Object.keys(sessionStorage))
			if (name.startsWith(prefix) && name !== `${prefix}${encodeURIComponent(session)}`)
				sessionStorage.removeItem(name);
	} catch {
		/* Storage unavailable. */
	}
	write(`${prefix}${encodeURIComponent(session)}`, value);
}
export function removeWorkView(account: string, device: string, session: string) {
	try {
		sessionStorage.removeItem(`${key(account, device)}:session:${encodeURIComponent(session)}`);
	} catch {
		/* Storage unavailable. */
	}
}

export function saveAllWork(client: QueryClient, account: string) {
	write(
		`${PREFIX}${encodeURIComponent(account)}:all`,
		dehydrate(client, {
			shouldDehydrateQuery: (q) =>
				q.queryKey[0] === "all-work" && q.queryKey[1] === account && q.state.data !== undefined,
		}),
	);
}
export function restoreAllWork(client: QueryClient, account: string, devices: readonly string[]) {
	const data = read(`${PREFIX}${encodeURIComponent(account)}:all`) as ReturnType<typeof dehydrate> | null;
	if (data?.queries)
		hydrate(client, { ...data, queries: data.queries.filter((q) => devices.includes(String(q.queryKey[2]))) });
}
export function reconcileWorkDevices(account: string, devices: readonly string[]) {
	try {
		const prefix = `${PREFIX}${encodeURIComponent(account)}:`;
		for (const name of Object.keys(sessionStorage)) {
			if (!name.startsWith(prefix)) continue;
			const part = name.slice(prefix.length).split(":")[0];
			if (part && part !== "all" && !devices.includes(decodeURIComponent(part))) sessionStorage.removeItem(name);
		}
	} catch {
		/* Storage unavailable. */
	}
}

export function reconcileWorkSessions(
	account: string,
	device: string,
	ids: readonly string[] | undefined,
	agentKeys?: readonly string[],
) {
	try {
		const prefix = `${key(account, device)}:session:`;
		for (const name of Object.keys(sessionStorage)) {
			if (!name.startsWith(prefix)) continue;
			const id = decodeURIComponent(name.slice(prefix.length));
			const view = read(name) as { session?: { mode?: string; agent?: string } } | null;
			const bot = view?.session;
			if (
				(ids && !ids.includes(id)) ||
				(agentKeys && bot?.agent && ["main", "persistent"].includes(bot.mode ?? "") && !agentKeys.includes(bot.agent))
			)
				sessionStorage.removeItem(name);
		}
	} catch {
		/* Storage unavailable. */
	}
}

/** Refresh the device snapshot only with the authoritative list returned for that device. */
export function updateStoredWork(account: string, device: string, kind: "sessions" | "agents", data: unknown) {
	const name = key(account, device);
	const cached = read(name) as ReturnType<typeof dehydrate> | null;
	if (!cached?.queries) return;
	const wanted = kind === "sessions" ? ["sessions", "work"] : ["device-agents", `account:${account}:device:${device}`];
	for (const query of cached.queries) {
		if (query.queryKey[0] === wanted[0] && query.queryKey[1] === wanted[1]) {
			query.state.data = data;
			query.state.dataUpdatedAt = Date.now();
		}
	}
	write(name, cached);
}
