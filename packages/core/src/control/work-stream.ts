import type { WorkControl } from "@yonder/sdk";

/** Serialize frame and event checks so revocation stops a stream without reordering it. */
export function guardedWorkStream(
	verify: () => Promise<void>,
	open: (send: (frame: unknown) => void, signal: AbortSignal) => Promise<{ frame(frame: unknown): void }>,
	send: (frame: unknown) => void,
	signal: AbortSignal,
) {
	const controller = new AbortController();
	if (signal.aborted) controller.abort();
	signal.addEventListener("abort", () => controller.abort(), { once: true });
	let queue = Promise.resolve();
	const guarded = (action: () => void, frame: unknown) => {
		queue = queue
			.then(async () => {
				if (controller.signal.aborted) return;
				await verify();
				if (!controller.signal.aborted) action();
			})
			.catch(() => {
				controller.abort();
				const sub = frame && typeof frame === "object" && "sub" in frame ? (frame as { sub: unknown }).sub : undefined;
				if (typeof sub === "string") send({ t: "end", sub, reason: "forbidden" });
			});
	};
	return open((frame) => guarded(() => send(frame), frame), controller.signal).then((stream) => ({
		frame(frame: unknown) {
			guarded(() => stream.frame(frame), frame);
		},
	}));
}

export async function verifyWorkOwner(
	instance: string,
	actor: string,
	agents: Array<{ id: string; owner?: string }>,
	account: (ref: string) => Promise<{ person?: string | null } | undefined>,
) {
	if (
		!/^[A-Za-z0-9_-]{1,64}$/.test(actor) ||
		!agents.length ||
		!agents[0]?.owner ||
		agents.some((agent) => !agent.owner || agent.owner !== agents[0]?.owner)
	)
		throw Object.assign(new Error("forbidden"), { code: "forbidden" });
	for (const agent of agents) {
		const person = (await account(`acct:${instance}:${agent.id}:${actor}`))?.person;
		if (!person || person !== agent.owner) throw Object.assign(new Error("forbidden"), { code: "forbidden" });
	}
}

export function createWorkHost(
	agents: () => Array<{ id: string; owner?: string }>,
	account: (ref: string) => Promise<{ person?: string | null } | undefined>,
	notify: () => void,
) {
	let host: ((id: string) => WorkControl) | undefined;
	const verified = (instance: string, actor: string) => verifyWorkOwner(instance, actor, agents(), account);
	return {
		set(value: ((id: string) => WorkControl) | undefined) {
			host = value;
			notify();
		},
		forInstance(instance: string): WorkControl {
			return {
				async ready(actor) {
					if (!host) return false;
					try {
						await verified(instance, actor);
						return true;
					} catch {
						return false;
					}
				},
				async request(actor, method, params, signal) {
					await verified(instance, actor);
					signal.throwIfAborted();
					if (!host) throw Object.assign(new Error("unavailable"), { code: "unavailable" });
					return host(instance).request(actor, method, params, signal);
				},
				async open(actor, send, signal) {
					await verified(instance, actor);
					signal.throwIfAborted();
					if (!host) throw Object.assign(new Error("unavailable"), { code: "unavailable" });
					const current = host(instance);
					return guardedWorkStream(
						() => verified(instance, actor),
						(emit, inner) => current.open(actor, emit, inner),
						send,
						signal,
					);
				},
			};
		},
	};
}

export function createKernelWorkHost(
	agents: Map<string, { id: string; owner?: string; archivedAt?: string }>,
	identity: { account(ref: string): Promise<{ person?: string | null } | undefined> },
	channels: Map<string, { controlReady?(): void }>,
) {
	return createWorkHost(
		() => [...agents.values()].filter((agent) => !agent.archivedAt),
		(ref) => identity.account(ref),
		() => {
			for (const channel of channels.values()) channel.controlReady?.();
		},
	);
}
