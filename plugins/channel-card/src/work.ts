import type { PluginAPI, Ref, WorkControl } from "@yonder/sdk";

/** One Card socket owns every request and subscription; it never replays a mutation. */
export class WorkBridge {
	private requests = new Map<string, AbortController>();
	private channels = new Map<
		string,
		{ abort: AbortController; frame?: (value: unknown) => void; pending: unknown[] }
	>();
	constructor(
		private control: WorkControl,
		private owner: string,
		private deviceId: string,
		private send: (value: unknown) => void,
	) {}
	close() {
		for (const c of this.requests.values()) c.abort();
		for (const c of this.channels.values()) c.abort.abort();
		this.requests.clear();
		this.channels.clear();
	}
	receive(data: Record<string, unknown>) {
		if (data.ownerId !== this.owner || data.deviceId !== this.deviceId) return;
		if (data.type === "work.request" && typeof data.requestId === "string" && typeof data.method === "string") {
			const id = data.requestId;
			if (this.requests.has(id)) return;
			const controller = new AbortController();
			this.requests.set(id, controller);
			void this.control
				.request(this.owner, data.method, data.params, controller.signal)
				.then(
					(result) => {
						if (!controller.signal.aborted) this.send({ type: "work.response", requestId: id, ok: true, result });
					},
					(error: unknown) => {
						if (!controller.signal.aborted)
							this.send({
								type: "work.response",
								requestId: id,
								ok: false,
								error: {
									code:
										typeof (error as { code?: unknown })?.code === "string"
											? (error as { code: string }).code
											: "error",
									message: error instanceof Error ? error.message : "error",
								},
							});
					},
				)
				.finally(() => this.requests.delete(id));
		} else if (data.type === "work.cancel" && typeof data.requestId === "string") {
			this.requests.get(data.requestId)?.abort();
			this.requests.delete(data.requestId);
		} else if (data.type === "work.open" && typeof data.channelId === "string") {
			const id = data.channelId;
			if (this.channels.has(id)) return;
			const entry: { abort: AbortController; frame?: (value: unknown) => void; pending: unknown[] } = {
				abort: new AbortController(),
				pending: [],
			};
			this.channels.set(id, entry);
			void this.control
				.open(
					this.owner,
					(frame) => {
						if (!entry.abort.signal.aborted) this.send({ type: "work.event", channelId: id, frame });
					},
					entry.abort.signal,
				)
				.then(
					(stream) => {
						if (!entry.abort.signal.aborted) {
							entry.frame = stream.frame;
							for (const frame of entry.pending) stream.frame(frame);
							entry.pending.length = 0;
						}
					},
					() => {
						entry.abort.abort();
						this.channels.delete(id);
					},
				);
		} else if (data.type === "work.frame" && typeof data.channelId === "string") {
			const channel = this.channels.get(data.channelId);
			if (channel?.frame) channel.frame(data.frame);
			else if (channel && channel.pending.length < 64) channel.pending.push(data.frame);
		} else if (data.type === "work.close" && typeof data.channelId === "string") {
			this.channels.get(data.channelId)?.abort.abort();
			this.channels.delete(data.channelId);
		}
	}
}

export async function linkWorkOwner(
	instance: string,
	api: PluginAPI,
	agents: Array<{ id: string; owner?: Ref }>,
	session: { actor?: { id?: unknown }; deviceId?: unknown },
	warn: (message: string) => void,
) {
	const actor = session?.actor?.id;
	if (typeof actor !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(actor)) throw new Error("Invalid card session");
	const owners: Array<{ agent: string; account: Ref; actor: string }> = [];
	for (const agent of agents) {
		if (!agent.owner) continue;
		const account = `acct:${instance}:${agent.id}:${actor}` as Ref;
		const existing = (await api.identity.account(account))?.person;
		if (existing) {
			if (existing === agent.owner) owners.push({ agent: agent.id, account, actor });
			continue;
		}
		if (!(await api.identity.person(agent.owner))) {
			warn(`Owner ${agent.owner} is unknown; ${agent.id} keeps its card account unlinked`);
			continue;
		}
		await api.identity.link(account, agent.owner);
		owners.push({ agent: agent.id, account, actor });
	}
	return { owners, deviceId: typeof session?.deviceId === "string" ? session.deviceId : undefined };
}

export async function openWorkBridge(
	control: WorkControl | undefined,
	owners: Array<{ actor: string }>,
	count: number,
	deviceId: string | undefined,
	send: (value: unknown) => void,
) {
	const actor = owners[0]?.actor;
	if (
		!actor ||
		!deviceId ||
		owners.length !== count ||
		!owners.every((owner) => owner.actor === actor) ||
		!control ||
		!(await control.ready(actor))
	)
		return;
	return new WorkBridge(control, actor, deviceId, send);
}
export function parseDeviceFrame(raw: { toString(): string }): Record<string, unknown> | undefined {
	try {
		const data: unknown = JSON.parse(raw.toString());
		return data && typeof data === "object" ? (data as Record<string, unknown>) : undefined;
	} catch {
		return;
	}
}
